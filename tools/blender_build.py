#!/usr/bin/env python3
"""Собрать мебель в Blender из scene3d.json: корпус, двери на петлях, ящики
на выкат, ручки, анимация открытия.

Запуск: blender -b -P blender_build.py -- scene3d.json OUTDIR [norender|stills]
"""
import bpy
import bmesh
import json
import math
import mathutils
import os
import sys

argv = sys.argv[sys.argv.index("--") + 1:]
src, outdir = argv[0], argv[1]
mode = argv[2] if len(argv) > 2 else ""
boxes = json.load(open(src, encoding="utf-8"))
S = 0.001
os.makedirs(outdir, exist_ok=True)

OPEN = 40          # кадр полного открытия
END = 60
DOOR_ANGLE = 95.0  # градусов

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene


def mk_mat(name, color, rough=0.6, metal=0.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    b.inputs["Base Color"].default_value = (*color, 1)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metal
    m.diffuse_color = (*color, 1)      # для Workbench (color_type='MATERIAL')
    return m


mats = {
    "corpus": mk_mat("ЛДСП", (0.80, 0.70, 0.55)),
    "facade": mk_mat("Фасад", (0.16, 0.26, 0.30), 0.35),
    "worktop": mk_mat("Столешница", (0.10, 0.10, 0.11), 0.30),
    "plinth": mk_mat("Цоколь", (0.08, 0.08, 0.09), 0.50),
    "back": mk_mat("Задник", (0.90, 0.90, 0.88)),
    "drawer": mk_mat("Ящик", (0.55, 0.55, 0.58), 0.40, 0.60),
    "handle": mk_mat("Ручка", (0.75, 0.76, 0.78), 0.25, 0.9),
    "leg": mk_mat("Ножка", (0.14, 0.14, 0.15), 0.40, 0.30),
}


def dims(b):
    return (b["x"] * S, b["y"] * S, b["z"] * S,
            b["sx"] * S, b["sy"] * S, b["sz"] * S)


def make_box_obj(b, mat, name, pivot=None):
    x, y, z, sx, sy, sz = dims(b)
    px, py, pz = pivot if pivot else (x + sx / 2, y + sy / 2, z + sz / 2)
    bm = bmesh.new()
    res = bmesh.ops.create_cube(bm, size=1.0)
    M = (mathutils.Matrix.Translation((x + sx / 2 - px, y + sy / 2 - py,
                                       z + sz / 2 - pz))
         @ mathutils.Matrix.Diagonal((sx, sy, sz, 1.0)))
    bmesh.ops.transform(bm, matrix=M, verts=res["verts"])
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    scene.collection.objects.link(ob)
    ob.location = (px, py, pz)
    ob.data.materials.append(mat)
    return ob


def make_handle(x, y, z, sx, sy, sz, parent):
    bm = bmesh.new()
    res = bmesh.ops.create_cube(bm, size=1.0)
    M = (mathutils.Matrix.Translation((x, y, z))
         @ mathutils.Matrix.Diagonal((sx, sy, sz, 1.0)))
    bmesh.ops.transform(bm, matrix=M, verts=res["verts"])
    me = bpy.data.meshes.new("Ручка")
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new("Ручка", me)
    scene.collection.objects.link(ob)
    ob.data.materials.append(mats["handle"])
    ob.parent = parent
    ob.matrix_parent_inverse = parent.matrix_world.inverted()
    return ob


# --- статика: каждая деталь — ОТДЕЛЬНЫЙ объект (ничего не склеиваем) ---
static_kinds = ("corpus", "back", "worktop", "plinth", "leg")
for b in boxes:
    if b["kind"] not in static_kinds:
        continue
    sec = b.get("sec", 0)
    nm = b["name"] + (f"·{sec}" if sec else "")
    make_box_obj(b, mats[b["kind"]], nm)

# --- двери ---
doors = []
for b in boxes:
    if b["kind"] != "door":
        continue
    x, y, z, sx, sy, sz = dims(b)
    hinge = b.get("hinge", "left")
    px = x if hinge == "left" else x + sx
    ob = make_box_obj(b, mats["facade"], f"Дверь·{b.get('sec', 0)}",
                      pivot=(px, y + sy / 2, z + sz / 2))
    ob["angle"] = math.radians(-DOOR_ANGLE if hinge == "left" else DOOR_ANGLE)
    ob["sec"] = b.get("sec", 0)
    doors.append(ob)

# --- фасады ящиков + короба ---
drawer_fronts = {}
for b in boxes:
    if b["kind"] != "drawerfront":
        continue
    ob = make_box_obj(b, mats["facade"], f"Фасад ящик·{b.get('sec', 0)}")
    ob["open"] = b["open"] * S
    ob["sec"] = b.get("sec", 0)
    drawer_fronts[b["drawer_id"]] = ob

bpy.context.view_layer.update()
# ручки
for b in boxes:
    if b["kind"] == "door":
        x, y, z, sx, sy, sz = dims(b)
        hinge = b.get("hinge", "left")
        ob = next(o for o in doors if abs(o.location.x - (x if hinge == "left"
                  else x + sx)) < 1e-6 and abs(o.location.z - (z + sz / 2)) < 1e-6)
        hx = (x + sx - 0.05) if hinge == "left" else (x + 0.05)
        make_handle(hx, y - 0.02, z + sz / 2, 0.03, 0.025, 0.16, ob)
    elif b["kind"] == "drawerfront":
        x, y, z, sx, sy, sz = dims(b)
        ob = drawer_fronts[b["drawer_id"]]
        make_handle(x + sx / 2, y - 0.02, z + sz - 0.05, min(0.30, sx * 0.5),
                    0.025, 0.03, ob)

# короба ящиков — дочерние к фасаду
for b in boxes:
    if b["kind"] != "drawerbox":
        continue
    ob = make_box_obj(b, mats["drawer"], f"Ящик·{b.get('sec', 0)}")
    fr = drawer_fronts.get(b["drawer_id"])
    if fr:
        ob.parent = fr
        ob.matrix_parent_inverse = fr.matrix_world.inverted()

# --- тайминги по секциям: открываем то, что в фокусе камеры ---
secs = {}
for b in boxes:
    s = b.get("sec", 0)
    if s:
        secs.setdefault(s, [1e9, -1e9])
        secs[s][0] = min(secs[s][0], b["x"])
        secs[s][1] = max(secs[s][1], b["x"] + b["sx"])
order = sorted(secs)
centers = {k: (secs[k][0] + secs[k][1]) / 2 * S for k in order}
DWELL, MOVE, OPEN_DUR = 30, 16, 14
t_of, open_start = {}, {}
_t = 1
for k in order:
    t_of[k] = _t
    open_start[k] = _t + 5
    _t += DWELL + MOVE
N_TOUR = t_of[order[-1]] + DWELL


def _fcurves(ob):
    act = ob.animation_data.action
    try:
        return list(act.fcurves)                       # Blender < 4.4
    except AttributeError:                             # Blender 5.x: слотовые экшены
        out = []
        for layer in act.layers:
            for strip in layer.strips:
                for cb in strip.channelbags:
                    out.extend(cb.fcurves)
        return out


def no_overshoot(ob):
    for fc in _fcurves(ob):
        for kp in fc.keyframe_points:
            kp.handle_left_type = kp.handle_right_type = "AUTO_CLAMPED"


for ob in doors:
    f = open_start.get(ob.get("sec", 0), 1)
    ob.rotation_euler = (0, 0, 0)
    ob.keyframe_insert("rotation_euler", frame=1)
    ob.keyframe_insert("rotation_euler", frame=f)
    ob.rotation_euler = (0, 0, ob["angle"])
    ob.keyframe_insert("rotation_euler", frame=f + OPEN_DUR)
    no_overshoot(ob)
    c = ob.constraints.new("LIMIT_ROTATION")           # блокируем всё, кроме Z
    c.use_limit_x = c.use_limit_y = True
    c.min_x = c.max_x = c.min_y = c.max_y = 0.0
    c.use_limit_z = True
    c.min_z, c.max_z = min(0.0, ob["angle"]), max(0.0, ob["angle"])
    c.owner_space = "LOCAL"

for ob in drawer_fronts.values():
    p = list(ob.location)
    f = open_start.get(ob.get("sec", 0), 1)
    ob.location = p
    ob.keyframe_insert("location", frame=1)
    ob.keyframe_insert("location", frame=f)
    ob.location = (p[0], p[1] - ob["open"], p[2])
    ob.keyframe_insert("location", frame=f + OPEN_DUR)
    no_overshoot(ob)

scene.frame_start, scene.frame_end = 1, N_TOUR

# --- мир, камера, свет ---
world = bpy.data.worlds.new("W")
scene.world = world
world.use_nodes = True
bg = world.node_tree.nodes["Background"]
bg.inputs[0].default_value = (0.92, 0.93, 0.96, 1)
bg.inputs[1].default_value = 0.7

cam_data = bpy.data.cameras.new("Cam")
cam = bpy.data.objects.new("Cam", cam_data)
scene.collection.objects.link(cam)
scene.camera = cam


def look_at(obj, tgt):
    d = mathutils.Vector(tgt) - obj.location
    obj.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()


sun_d = bpy.data.lights.new("Sun", "SUN")
sun_d.energy = 3.5
sun_d.angle = 0.3
sun = bpy.data.objects.new("Sun", sun_d)
scene.collection.objects.link(sun)
sun.location = (3, -6, 7)
look_at(sun, (5, 0.3, 0.4))
area_d = bpy.data.lights.new("Area", "AREA")
area_d.energy = 500
area_d.size = 9
area = bpy.data.objects.new("Area", area_d)
scene.collection.objects.link(area)
area.location = (5, -4.5, 3.0)
look_at(area, (5, 0.3, 0.6))

scene.render.engine = "CYCLES"
scene.cycles.samples = 24
scene.cycles.use_denoising = True
scene.cycles.device = "CPU"
scene.render.film_transparent = False
scene.view_settings.view_transform = "Standard"


def set_cam(loc, tgt, lens, ortho=None):
    cam.location = loc
    cam_data.lens = lens
    cam_data.type = "ORTHO" if ortho else "PERSP"
    if ortho:
        cam_data.ortho_scale = ortho
    look_at(cam, tgt)


if mode == "tour":
    # камера делает остановку у каждой секции (отодвинута, чуть сверху)
    tgt = bpy.data.objects.new("Target", None)
    scene.collection.objects.link(tgt)
    con = cam.constraints.new("TRACK_TO")
    con.target = tgt
    con.track_axis = "TRACK_NEGATIVE_Z"
    con.up_axis = "UP_Y"
    for k in order:
        cx = centers[k]
        for fr in (t_of[k], t_of[k] + DWELL):
            cam.location = (cx - 0.7, -3.6, 1.5)
            cam.keyframe_insert("location", frame=fr)
            tgt.location = (cx + 0.15, 0.30, 0.55)
            tgt.keyframe_insert("location", frame=fr)
    for ob in (cam, tgt):
        for fc in _fcurves(ob):
            for kp in fc.keyframe_points:
                kp.interpolation = "LINEAR"
    scene.render.engine = "BLENDER_WORKBENCH"
    sh = scene.display.shading
    sh.light = "STUDIO"
    sh.color_type = "MATERIAL"
    sh.show_shadows = True
    sh.show_cavity = True
    scene.render.resolution_x, scene.render.resolution_y = 1280, 540
    try:
        scene.render.image_settings.media_type = "VIDEO"
    except Exception:
        pass
    scene.render.image_settings.file_format = "FFMPEG"
    scene.render.ffmpeg.format = "MPEG4"
    scene.render.ffmpeg.codec = "H264"
    scene.render.ffmpeg.constant_rate_factor = "HIGH"
    scene.render.fps = 24
    scene.render.filepath = os.path.join(outdir, "kitchen_tour.mp4")
    scene.frame_set(1)
    bpy.ops.render.render(animation=True)
    print("rendered tour")
else:
    if mode not in ("norender", "anim"):
        try:
            scene.render.image_settings.media_type = "IMAGE"
        except Exception:
            pass
        scene.render.image_settings.file_format = "PNG"
        set_cam((0.6, -5.2, 2.2), (3.2, 0.30, 0.50), 32)
        scene.render.resolution_x, scene.render.resolution_y = 2200, 1150
        for fr, tag in ((1, "closed"), (N_TOUR, "open")):
            scene.frame_set(fr)
            scene.render.filepath = os.path.join(outdir, f"kitchen_3q_{tag}.png")
            bpy.ops.render.render(write_still=True)
            print("rendered 3q", tag)
        set_cam((5, -8.0, 0.45), (5, 0.30, 0.45), 50, ortho=10.9)
        scene.render.resolution_x, scene.render.resolution_y = 2560, 620
        scene.frame_set(N_TOUR)
        scene.render.filepath = os.path.join(outdir, "kitchen_front_open.png")
        bpy.ops.render.render(write_still=True)
        print("rendered front open")
        set_cam((10.9, -2.4, 1.7), (9.0, 0.30, 0.50), 40)
        scene.render.resolution_x, scene.render.resolution_y = 1700, 1100
        scene.frame_set(N_TOUR)
        scene.render.filepath = os.path.join(outdir, "kitchen_end_open.png")
        bpy.ops.render.render(write_still=True)
        print("rendered end open")

    if mode not in ("norender", "stills"):
        set_cam((0.6, -5.2, 2.2), (3.2, 0.30, 0.50), 32)
        scene.render.resolution_x, scene.render.resolution_y = 1280, 540
        scene.render.engine = "BLENDER_EEVEE"
        try:
            scene.eevee.taa_render_samples = 16
        except Exception:
            pass
        scene.frame_start, scene.frame_end = 1, N_TOUR
        try:
            scene.render.image_settings.media_type = "VIDEO"
        except Exception:
            pass
        scene.render.image_settings.file_format = "FFMPEG"
        scene.render.ffmpeg.format = "MPEG4"
        scene.render.ffmpeg.codec = "H264"
        scene.render.ffmpeg.constant_rate_factor = "MEDIUM"
        scene.render.fps = 24
        scene.render.filepath = os.path.join(outdir, "kitchen_anim.mp4")
        scene.frame_set(1)
        bpy.ops.render.render(animation=True)
        print("rendered animation")

bpy.ops.wm.save_as_mainfile(filepath=os.path.join(outdir, "kitchen.blend"))
print("saved kitchen.blend")
print("DONE")
