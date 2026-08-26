/** Web application entry with an optional Supabase Auth gate for deployments. */
import { createClient, type Session, type SupabaseClient } from '@supabase/supabase-js'
import { AppWebEntry } from '@orygin-ai/dsh-client-web'
import './auth.css'

const rootElement = document.getElementById('root')
if (rootElement === null) throw new Error('web app: missing #root')
const el: HTMLElement = rootElement

interface AuthGlobal {
  __ORYGIN_AUTH__?: {
    getAccessToken: () => string | undefined
  }
}

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined
const authRequired = import.meta.env.VITE_ORYGIN_AUTH_REQUIRED === '1'

let accessToken: string | undefined
let appStarted = false

function publishSession(session: Session | null): void {
  accessToken = session?.access_token
  ;(globalThis as AuthGlobal).__ORYGIN_AUTH__ = {
    getAccessToken: () => accessToken,
  }
}

async function startApp(): Promise<void> {
  if (appStarted) return
  appStarted = true
  el.replaceChildren()
  await new AppWebEntry(el).run()
}

function showConfigurationError(message: string): void {
  el.innerHTML = `<main class="orygin-auth-state"><section class="orygin-auth-state-card" role="alert">
    <p class="orygin-auth-eyebrow">Espace Orygin</p><h1>Configuration indisponible</h1><p id="orygin-auth-config-message"></p></section></main>`
  const messageElement = document.getElementById('orygin-auth-config-message')
  if (messageElement !== null) messageElement.textContent = message
}

function showAuthGate(supabase: SupabaseClient): void {
  el.innerHTML = `<main class="orygin-auth-page">
    <section class="orygin-auth-main" aria-labelledby="orygin-auth-title">
      <div class="orygin-auth-main-inner">
        <div class="orygin-auth-brand-header"><img class="orygin-auth-logo" src="/favicon.svg" alt="" /><span>ORYGIN</span></div>
        <div class="orygin-auth-card">
          <div class="orygin-auth-card-header">
            <h1 id="orygin-auth-title">Connexion</h1>
            <p id="orygin-auth-description">Accède à ton espace Orygin.</p>
          </div>
          <div class="orygin-auth-mode" role="tablist" aria-label="Mode d’accès">
            <button id="orygin-auth-login-mode" class="orygin-auth-mode-button" type="button" role="tab" aria-selected="true">Se connecter</button>
            <button id="orygin-auth-signup-mode" class="orygin-auth-mode-button" type="button" role="tab" aria-selected="false">Créer un compte</button>
          </div>
          <form id="orygin-auth-form" class="orygin-auth-form">
            <label class="orygin-auth-field"><span>Adresse email</span>
              <span class="orygin-auth-field-control">
                <input class="orygin-auth-input" name="email" type="email" placeholder="toi@exemple.com" autocomplete="email" required />
              </span>
            </label>
            <label class="orygin-auth-field"><span>Mot de passe</span>
              <span class="orygin-auth-field-control">
                <input class="orygin-auth-input" name="password" type="password" minlength="6" placeholder="Au moins 6 caractères" autocomplete="current-password" required />
                <button id="orygin-auth-password-toggle" class="orygin-auth-password-toggle" type="button" aria-label="Afficher le mot de passe" aria-pressed="false">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" /><circle cx="12" cy="12" r="2.5" /></svg>
                </button>
              </span>
            </label>
            <button id="orygin-auth-submit" class="orygin-auth-submit" type="submit">Se connecter</button>
            <p id="orygin-auth-status" class="orygin-auth-status" role="status" aria-live="polite"></p>
          </form>
          <div class="orygin-auth-card-footer"><span id="orygin-auth-footer-prompt">Pas encore de compte ?</span><button id="orygin-auth-footer-toggle" type="button">Créer un compte</button></div>
        </div>
      </div>
    </section>
  </main>`

  const form = document.getElementById('orygin-auth-form') as HTMLFormElement | null
  const submit = document.getElementById('orygin-auth-submit') as HTMLButtonElement | null
  const loginMode = document.getElementById('orygin-auth-login-mode') as HTMLButtonElement | null
  const signupMode = document.getElementById('orygin-auth-signup-mode') as HTMLButtonElement | null
  const footerToggle = document.getElementById('orygin-auth-footer-toggle') as HTMLButtonElement | null
  const footerPrompt = document.getElementById('orygin-auth-footer-prompt')
  const title = document.getElementById('orygin-auth-title')
  const description = document.getElementById('orygin-auth-description')
  const passwordToggle = document.getElementById('orygin-auth-password-toggle') as HTMLButtonElement | null
  const status = document.getElementById('orygin-auth-status')
  if (
    form === null || submit === null || loginMode === null || signupMode === null
    || footerToggle === null || footerPrompt === null || title === null || description === null
    || passwordToggle === null || status === null
  ) return

  let signUp = false
  const setMode = (nextSignUp: boolean): void => {
    signUp = nextSignUp
    submit.textContent = signUp ? 'Créer mon compte' : 'Se connecter'
    loginMode.setAttribute('aria-selected', String(!signUp))
    signupMode.setAttribute('aria-selected', String(signUp))
    title.textContent = signUp ? 'Créer un compte' : 'Connexion'
    description.textContent = signUp ? 'Crée ton espace Orygin.' : 'Accède à ton espace Orygin.'
    footerPrompt.textContent = signUp ? 'Tu as déjà un compte ?' : 'Pas encore de compte ?'
    footerToggle.textContent = signUp ? 'Se connecter' : 'Créer un compte'
    const password = form.elements.namedItem('password') as HTMLInputElement | null
    if (password !== null) password.autocomplete = signUp ? 'new-password' : 'current-password'
    status.textContent = ''
    status.removeAttribute('data-tone')
  }

  loginMode.addEventListener('click', () => {
    setMode(false)
  })
  signupMode.addEventListener('click', () => {
    setMode(true)
  })
  footerToggle.addEventListener('click', () => {
    setMode(!signUp)
  })
  passwordToggle.addEventListener('click', () => {
    const password = form.elements.namedItem('password') as HTMLInputElement | null
    if (password === null) return
    const visible = password.type === 'text'
    password.type = visible ? 'password' : 'text'
    passwordToggle.setAttribute('aria-pressed', String(!visible))
    passwordToggle.setAttribute('aria-label', visible ? 'Afficher le mot de passe' : 'Masquer le mot de passe')
  })

  form.addEventListener('submit', (event) => {
    event.preventDefault()
    void (async () => {
      submit.disabled = true
      status.textContent = signUp ? 'Création du compte…' : 'Connexion…'
      status.removeAttribute('data-tone')
      const emailInput = form.elements.namedItem('email')
      const passwordInput = form.elements.namedItem('password')
      if (!(emailInput instanceof HTMLInputElement) || !(passwordInput instanceof HTMLInputElement)) {
        status.textContent = 'Le formulaire est incomplet. Recharge la page et réessaie.'
        status.setAttribute('data-tone', 'error')
        submit.disabled = false
        return
      }
      const email = emailInput.value.trim()
      const password = passwordInput.value
      const result = signUp
        ? await supabase.auth.signUp({ email, password })
        : await supabase.auth.signInWithPassword({ email, password })
      if (result.error !== null) {
        status.textContent = result.error.message
        status.setAttribute('data-tone', 'error')
        submit.disabled = false
        return
      }
      publishSession(result.data.session)
      if (result.data.session === null) {
        status.textContent = 'Compte créé. Vérifie ton email pour confirmer ton inscription.'
        status.setAttribute('data-tone', 'success')
        submit.disabled = false
        return
      }
      await startApp()
    })().catch((error: unknown) => {
      status.textContent = error instanceof Error ? error.message : String(error)
      status.setAttribute('data-tone', 'error')
      submit.disabled = false
    })
  })
}

async function bootstrap(): Promise<void> {
  if (!authRequired) {
    publishSession(null)
    await startApp()
    return
  }
  if (supabaseUrl === undefined || supabaseKey === undefined || supabaseUrl === '' || supabaseKey === '') {
    showConfigurationError('Authentification Supabase non configurée pour ce déploiement.')
    return
  }
  const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  })
  const { data, error } = await supabase.auth.getSession()
  if (error !== null) {
    showConfigurationError(`Impossible de charger la session : ${error.message}`)
    return
  }
  publishSession(data.session)
  if (data.session === null) showAuthGate(supabase)
  else await startApp()
  supabase.auth.onAuthStateChange((_event, session) => {
    publishSession(session)
    if (session !== null && !appStarted) queueMicrotask(() => { void startApp() })
    if (session === null && appStarted) window.location.reload()
  })
}

void bootstrap().catch((error: unknown) => {
  showConfigurationError(error instanceof Error ? error.message : String(error))
})
