<script setup lang="ts">
import { computed, ref } from 'vue'
import { auth, enterDemo, login, register } from '../state/auth'

const emit = defineEmits<{ (e: 'ready'): void }>()
const mode = ref<'login' | 'register'>('login')
const email = ref('')
const password = ref('')
const name = ref('')
const localError = ref('')

const busy = computed(() => auth.pending)
const title = computed(() => mode.value === 'login' ? 'Вход' : 'Регистрация')

async function submit(): Promise<void> {
  localError.value = ''
  if (!email.value.trim() || !password.value) {
    localError.value = 'Заполните e-mail и пароль'
    return
  }
  try {
    if (mode.value === 'login') await login(email.value, password.value)
    else await register(email.value, password.value, name.value)
    emit('ready')
  } catch {
    /* auth.error already set */
  }
}

async function demo(): Promise<void> {
  localError.value = ''
  try {
    await enterDemo()
    emit('ready')
  } catch {
    /* auth.error already set */
  }
}

function switchMode(): void {
  mode.value = mode.value === 'login' ? 'register' : 'login'
  localError.value = ''
  auth.error = ''
}
</script>

<template>
  <main class="auth">
    <section class="auth__brand">
      <div class="auth__mark" aria-hidden="true"></div>
      <p class="auth__eyebrow">FURNITURE</p>
      <h1>Конструктор мебели,<br />который считает всё</h1>
      <p class="auth__lead">
        Деталировка, присадка, раскрой, фурнитура и коммерческое предложение —
        в одном рабочем месте.
      </p>

      <ul class="auth__features">
        <li><b>3D и план</b><span>Соберите помещение и модули</span></li>
        <li><b>Точная присадка</b><span>Отверстия, крепёж, карта сборки</span></li>
        <li><b>Цены по рынкам</b><span>Валюты, цеха, поставщики</span></li>
      </ul>

      <button class="auth__demo" :disabled="busy" @click="demo">
        <span>Посмотреть демо</span>
        <span aria-hidden="true">→</span>
      </button>
      <p class="auth__demo-note">Без регистрации. Демо-кухня и подсказки по шагам.</p>
    </section>

    <section class="auth__card">
      <div class="auth__card-head">
        <div>
          <h2>{{ title }}</h2>
          <p class="dim">Продолжите работу или создайте аккаунт</p>
        </div>
        <span class="auth__badge">beta</span>
      </div>

      <form class="auth__form" @submit.prevent="submit">
        <label v-if="mode === 'register'" class="field">
          <span class="field__label">Как вас зовут</span>
          <input v-model="name" class="input" autocomplete="name" placeholder="Иван" />
        </label>
        <label class="field">
          <span class="field__label">E-mail</span>
          <input
            v-model="email" class="input" type="email" autocomplete="email"
            placeholder="you@example.com" required
          />
        </label>
        <label class="field">
          <span class="field__label">Пароль</span>
          <input
            v-model="password" class="input" type="password" minlength="8"
            :autocomplete="mode === 'login' ? 'current-password' : 'new-password'"
            placeholder="Минимум 8 символов" required
          />
        </label>

        <p v-if="localError || auth.error" class="auth__error">
          {{ localError || auth.error }}
        </p>

        <button class="btn btn--primary auth__submit" :disabled="busy" type="submit">
          {{ busy ? 'Подождите…' : mode === 'login' ? 'Войти' : 'Создать аккаунт' }}
        </button>
      </form>

      <button class="link auth__switch" @click="switchMode">
        {{ mode === 'login' ? 'Нет аккаунта? Зарегистрироваться' : 'Уже есть аккаунт? Войти' }}
      </button>

      <p class="dim auth__legal">
        Продолжая, вы принимаете условия демо-версии. Проекты сохраняются
        на сервере и доступны с любого устройства после входа.
      </p>
    </section>
  </main>
</template>
