# @orygin-ai/dsh-shell-env

English | [中文](README.zh.md)

The tool-independent shell environment plugin: owns the `ctx.shellEnv` registry of trusted, per-execution `ORYGIN_*` variables that the model-facing shell tools (`dsh-tool-bash`, `dsh-tool-pwsh`) collect into every shell call's environment. Built-in shell facts (`ORYGIN_HOME`, `ORYGIN_SHELL=1`, `ORYGIN_SESSION_ID`) are owned by the registry itself; other plugins register additional enumerable facts with effect-scoped disposal, and duplicate ownership or undeclared runtime keys fail loudly.

The package root exports the Cordis plugin contract (`name`, `inject`, `Config`, `apply`) plus the `ShellEnvRegistry` service class and its contributor types; consumers use `ctx.shellEnv` after loading this plugin.

## Config

```yaml
- id: shell-env
  name: '@orygin-ai/dsh-shell-env'
  config:
    dshHome: C:\Users\me\.dsh   # default: $ORYGIN_HOME, then ~/.dsh
```

## Managed environment

Every foreground and background model shell call receives a newly collected trusted `ORYGIN_*` environment. `ORYGIN_HOME` is the absolute Harness home resolved by [`@orygin-ai/dsh-home-paths`](../../util/home-paths/README.md) (`dshHome` config, then ambient `$ORYGIN_HOME`, then `~/.dsh`) and `ORYGIN_SHELL=1` identifies the managed child. Agent calls additionally receive `ORYGIN_SESSION_ID=agent.session.header.id`; when the active persistence seam locates a JSONL artifact they also receive `ORYGIN_SESSION_JSONL=<absolute target path>`. The JSONL path is a location hint: it may not exist before the first flush or contain the current buffered turn, and it is not an authorization credential.

`ctx.shellEnv` owns collection. Other plugins can register an effect-scoped contributor with a stable name, declared keys/descriptions, and `resolve(execution: ToolExecution)`; duplicate ownership and undeclared runtime keys fail loudly, while `list()` enumerates declarations without executing providers. Harness built-ins reserve `ORYGIN_HOME`, `ORYGIN_SHELL`, and `ORYGIN_SESSION_ID`; this plugin's persistence translator owns `ORYGIN_SESSION_JSONL` by reading the backend-neutral `sessionPersistence.locate()` seam.

```ts
import type { Context } from '@orygin-ai/cordis'
import type {} from '@orygin-ai/dsh-shell-env'

export const inject = ['shellEnv']

export function apply(ctx: Context): void {
  ctx.shellEnv.register({
    name: 'deployment-region',
    variables: { ORYGIN_DEPLOYMENT_REGION: { description: 'Current deployment region.' } },
    resolve: execution => execution.agent === undefined ? {} : { ORYGIN_DEPLOYMENT_REGION: 'cn-north' },
  })
}
```

The overlay is computed from the current `ToolExecution` and passed through the dedicated `ShellExecRequest.dshEnv` channel. The local executors remove all inherited `ORYGIN_*` before merging that snapshot, so nested harnesses and concurrent parent/child agents cannot leak stale identities. `process.env` is never modified. The shell tools' descriptions teach the generic `$ORYGIN_*` convention rather than naming persistence-specific variables or adding a permanent system-prompt section.

## Model Experience

Indirectly, through the shell tools (`dsh-tool-bash`, `dsh-tool-pwsh`), which collect this registry's managed `ORYGIN_*` snapshot into every shell-tool call.

#### KV Cache effect

No direct invalidation; the named consumers own any request-prefix changes.

## Known Limitations and Deferred Work

- **`list()` enumerates contributor-declared variables only** — registry-owned built-ins (`ORYGIN_HOME`, `ORYGIN_SHELL`, `ORYGIN_SESSION_ID`) are not included, so diagnostics, prompt, or UI code must not treat `list()` as an exhaustive environment catalog.
