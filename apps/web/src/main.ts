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
    <section class="orygin-auth-brand" aria-label="Orygin">
      <div class="orygin-auth-brand-header"><img class="orygin-auth-logo" src="/favicon.svg" alt="" /><span>ORYGIN</span></div>
      <div class="orygin-auth-brand-content">
        <p class="orygin-auth-eyebrow">Workspace privé</p>
        <h2>Des idées plus claires.<br /><span>Des actions plus rapides.</span></h2>
        <p class="orygin-auth-brand-lead">Un espace de travail pensé pour transformer chaque intention en résultat, avec une expérience simple, fluide et concentrée.</p>
        <ul class="orygin-auth-benefits">
          <li class="orygin-auth-benefit"><span class="orygin-auth-benefit-mark" aria-hidden="true">✓</span><span>Retrouve tes projets au même endroit</span></li>
          <li class="orygin-auth-benefit"><span class="orygin-auth-benefit-mark" aria-hidden="true">✓</span><span>Garde le fil de chaque conversation</span></li>
          <li class="orygin-auth-benefit"><span class="orygin-auth-benefit-mark" aria-hidden="true">✓</span><span>Avance dans un environnement sécurisé</span></li>
        </ul>
      </div>
      <div class="orygin-auth-brand-footer">Conçu pour aller à l’essentiel</div>
    </section>
    <section class="orygin-auth-main">
      <div class="orygin-auth-main-inner">
        <div class="orygin-auth-mobile-brand"><img class="orygin-auth-logo" src="/favicon.svg" alt="" /><span>ORYGIN</span></div>
        <div class="orygin-auth-card">
          <div class="orygin-auth-card-header">
            <p class="orygin-auth-eyebrow">Espace Orygin</p>
            <h1 id="orygin-auth-title">Bienvenue chez Orygin</h1>
            <p id="orygin-auth-description">Connecte-toi pour retrouver ton espace de travail.</p>
          </div>
          <div class="orygin-auth-mode" role="tablist" aria-label="Mode d’accès">
            <button id="orygin-auth-login-mode" class="orygin-auth-mode-button" type="button" role="tab" aria-selected="true">Se connecter</button>
            <button id="orygin-auth-signup-mode" class="orygin-auth-mode-button" type="button" role="tab" aria-selected="false">Créer un compte</button>
          </div>
          <form id="orygin-auth-form" class="orygin-auth-form">
            <label class="orygin-auth-field"><span>Adresse email</span>
              <span class="orygin-auth-field-control">
                <svg class="orygin-auth-input-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m4 7 8 6 8-6" /></svg>
                <input class="orygin-auth-input" name="email" type="email" placeholder="toi@exemple.com" autocomplete="email" required />
              </span>
            </label>
            <label class="orygin-auth-field"><span>Mot de passe</span>
              <span class="orygin-auth-field-control">
                <svg class="orygin-auth-input-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><rect x="5" y="10" width="14" height="10" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></svg>
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
        <p class="orygin-auth-security-note"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M12 3 19 6v5c0 4.5-2.8 8.3-7 10-4.2-1.7-7-5.5-7-10V6l7-3Z" /><path d="m9 12 2 2 4-4" /></svg><span>Tes données restent protégées pendant toute la session.</span></p>
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
    title.textContent = signUp ? 'Crée ton espace Orygin' : 'Bienvenue chez Orygin'
    description.textContent = signUp ? 'Crée ton compte en quelques secondes pour commencer.' : 'Connecte-toi pour retrouver ton espace de travail.'
    footerPrompt.textContent = signUp ? 'Tu as déjà un compte ?' : 'Pas encore de compte ?'
    footerToggle.textContent = signUp ? 'Se connecter' : 'Créer un compte'
    const password = form.elements.namedItem('password') as HTMLInputElement | null
    if (password !== null) password.autocomplete = signUp ? 'new-password' : 'current-password'
    status.textContent = ''
    status.removeAttribute('data-tone')
  }

  loginMode.addEventListener('click', () => setMode(false))
  signupMode.addEventListener('click', () => setMode(true))
  footerToggle.addEventListener('click', () => setMode(!signUp))
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
      const email = String((form.elements.namedItem('email') as HTMLInputElement).value).trim()
      const password = String((form.elements.namedItem('password') as HTMLInputElement).value)
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
