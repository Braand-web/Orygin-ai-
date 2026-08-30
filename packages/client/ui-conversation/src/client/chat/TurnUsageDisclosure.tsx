import { useState } from 'react'
import { DisclosureRow, IconDataOutline16 } from '@orygin-ai/dsh-client-ui-primitives'
import type { TurnTokenUsage } from '../contract/chat-nodes.ts'
import type { ChatViewSlotProps } from '../contract/slots.ts'
import css from './TurnUsageDisclosure.module.css'

export interface TurnUsageDisclosureProps {
  usage: TurnTokenUsage
  t: ChatViewSlotProps['t']
}

function compact(value: number): string {
  if (value < 1_000) return String(value)
  if (value < 1_000_000) return `${Math.round(value / 100) / 10}K`
  return `${Math.round(value / 100_000) / 10}M`
}

function exact(value: number, t: ChatViewSlotProps['t']): string {
  const digits = String(value)
  const groups: string[] = []
  for (let end = digits.length; end > 0; end -= 3) groups.unshift(digits.slice(Math.max(0, end - 3), end))
  return t('message.turnUsage.count', { count: groups.join(t('number.groupSeparator')) })
}

function cachePercent(cacheRead: number, prompt: number): string | null {
  if (prompt <= 0) return null
  if (cacheRead >= prompt) return '100'
  const percent = cacheRead / prompt * 100
  return percent >= 99.95 ? percent.toFixed(2).replace(/0+$/, '').replace(/\.$/, '') : String(Math.round(percent))
}

/** Compact per-turn usage summary with an opt-in exact bucket breakdown. */
export function TurnUsageDisclosure({ usage, t }: TurnUsageDisclosureProps) {
  const [open, setOpen] = useState(false)
  const prompt = usage.totalTokens - usage.outputTokens
  const cacheHit = usage.cacheReadTokens === undefined
    ? null
    : cachePercent(usage.cacheReadTokens, prompt)
  const total = t('message.turnUsage.count', { count: compact(usage.totalTokens) })
  const summary = cacheHit === null
    ? total
    : t('message.turnUsage.summaryWithCache', { total, percent: cacheHit })
  const routes = usage.routes?.map(route => `${route.provider}/${route.model}`).join(', ') ?? ''
  return (
    <DisclosureRow
      icon={<IconDataOutline16 />}
      title={t('message.turnUsage.title')}
      open={open}
      expandable
      onToggle={() => { setOpen(value => !value) }}
      expandOnRowClick
      keepContentWhenOpen
      collapsedContent={<><span className={css.separator} aria-hidden /><span className={css.summary}>{summary}</span></>}
      className={css.root}
      chevronClassName={css.chevron}
    >
      <dl className={css.details} data-turn-usage-details>
        {routes !== '' && <><dt>{t('message.turnUsage.model')}</dt><dd className={css.route}>{routes}</dd></>}
        <dt>{t('message.turnUsage.input')}</dt><dd>{exact(usage.uncachedInputTokens, t)}</dd>
        {usage.cacheReadTokens !== undefined && <><dt>{t('message.turnUsage.cacheRead')}</dt><dd>{exact(usage.cacheReadTokens, t)}</dd></>}
        {usage.cacheWriteTokens !== undefined && <><dt>{t('message.turnUsage.cacheWrite')}</dt><dd>{exact(usage.cacheWriteTokens, t)}</dd></>}
        <dt>{t('message.turnUsage.output')}</dt>
        <dd>{exact(usage.outputTokens, t)}{usage.reasoningTokens !== undefined && <span className={css.reasoning}>{t('message.turnUsage.reasoning', { tokens: exact(usage.reasoningTokens, t) })}</span>}</dd>
        <dt className={css.totalLabel}>{t('message.turnUsage.total')}</dt><dd className={css.totalValue}>{exact(usage.totalTokens, t)}</dd>
      </dl>
    </DisclosureRow>
  )
}
