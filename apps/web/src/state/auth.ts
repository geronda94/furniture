import { reactive } from 'vue'
import {
  apiDemo,
  apiLogin,
  apiLogout,
  apiMe,
  apiRegister,
  type AuthUser,
} from '../api'

export const auth = reactive({
  ready: false,
  pending: false,
  user: null as AuthUser | null,
  error: '',
})

export async function initAuth(): Promise<void> {
  try {
    auth.user = await apiMe()
  } catch {
    auth.user = null
  } finally {
    auth.ready = true
  }
}

async function run(fn: () => Promise<{ user: AuthUser; project_id?: string }>): Promise<AuthUser> {
  auth.pending = true
  auth.error = ''
  try {
    const result = await fn()
    auth.user = result.user
    if (result.project_id) {
      try {
        localStorage.setItem('furniture.project', result.project_id)
      } catch {
        /* ignore */
      }
    }
    return result.user
  } catch (e) {
    auth.error = e instanceof Error ? e.message : String(e)
    throw e
  } finally {
    auth.pending = false
  }
}

export function login(email: string, password: string): Promise<AuthUser> {
  return run(() => apiLogin(email.trim(), password))
}

export function register(
  email: string, password: string, name: string,
): Promise<AuthUser> {
  return run(() => apiRegister(email.trim(), password, name.trim()))
}

export function enterDemo(): Promise<AuthUser> {
  return run(() => apiDemo())
}

export async function logout(): Promise<void> {
  await apiLogout().catch(() => {})
  auth.user = null
  try {
    localStorage.removeItem('furniture.project')
  } catch {
    /* ignore */
  }
}
