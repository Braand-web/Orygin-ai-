/** Durable settings namespace for product-wide GUI onboarding facts. */
export const WELCOME_NOTICE_SETTINGS_NAMESPACE = 'ui-onboarding'

/** Field storing the last welcome notice version the user acknowledged. */
export const WELCOME_NOTICE_ACK_FIELD = 'welcomeNoticeVersion'

/**
 * Bump only when the notice changes materially and every user should see it
 * again. The acknowledgement is compared for exact equality.
 */
export const WELCOME_NOTICE_VERSION = '2026-08-26.1'

/** The complete editable internal-testing notice in both supported GUI locales. */
export const WELCOME_NOTICE_COPY = {
  zh: {
    title: '内测声明',
    body: 'Orygin 目前的 0.1 版本仍处在内部测试阶段，还有许多地方需要持续改进和打磨。预计 Orygin 的核心功能以及基础 API 都会在接下来的一段时间内快速迭代、持续演化。\n\n我们专注于为 Orygin 用户提供稳定、安全且高效的工作空间。',
    continueLabel: '继续',
  },
  en: {
    title: 'Internal Testing Notice',
    body: "Orygin 0.1 is currently in private testing. Many areas still need refinement, and Orygin's core features and foundational APIs will continue to evolve rapidly over the coming months.\n\nWe are focused on delivering a stable, secure, and efficient workspace for Orygin users.",
    continueLabel: 'Continue',
  },
} as const
