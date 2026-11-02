/**
 * dsh-skill-router
 *
 * Replaces the always-on skill catalog with on-demand discovery:
 *  - `skill_search` ranks enabled skills by keyword mapping + metadata,
 *  - `skill_manager` toggles skills, edits routing keywords, and manages
 *    system-prompt sections,
 *  - the full catalog message injected by dsh-tool-skill is removed per step,
 *  - disabled skills are blocked by a tool guard,
 *  - state persists in <DSH_HOME>/skill-router/state.json.
 *
 * Host-only bundle: it imports node builtins only, so it works from a linked
 * workspace checkout without a node_modules chain to the dsh installation.
 */
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'

export const name = 'skill-router'
export const inject = ['skills', 'tools', 'systemPrompt']

const CATALOG_SOURCE = 'skill-catalog'
const HINT_SOURCE = 'skill-router'
const PROMPT_SECTION = 'skill-router'
const EXTRA_SECTION = 'skill-router-extra'

const ROUTER_PROMPT = [
  '## Skills are on demand',
  '',
  'This session does not preload the skill catalog. A skill is a reusable set of task-specific instructions.',
  'When a task may match a skill, call `skill_search` with a few keywords (framework, language, document type, or the user\'s terms), then call the `skill` tool with the exact name it returns before acting. Load every applicable skill.',
  'Do not call `skill` with a guessed or remembered name; discover it first with `skill_search`.',
  'Use `skill_manager` only when the user asks to change skill-router settings (enable/disable a skill, edit routing keywords, or manage system-prompt sections).',
].join('\n')

function dshHome() {
  const configured = process.env.DSH_HOME
  if (typeof configured === 'string' && configured.trim().length > 0) return configured.trim()
  return join(homedir(), '.dsh')
}

function defaultStateFile() {
  return join(dshHome(), 'skill-router', 'state.json')
}

function normalizeKeywords(value) {
  if (Array.isArray(value)) {
    return value.filter((item) => typeof item === 'string' && item.trim().length > 0).map((item) => item.trim())
  }
  if (typeof value === 'string') {
    return value.split(/[,，;；\n]+/).map((item) => item.trim()).filter((item) => item.length > 0)
  }
  return []
}

function normalizeState(raw) {
  const skills = {}
  const rawSkills = raw && typeof raw === 'object' && raw.skills && typeof raw.skills === 'object' ? raw.skills : {}
  for (const [skillName, value] of Object.entries(rawSkills)) {
    if (skillName.length === 0 || value === null || typeof value !== 'object') continue
    const record = {}
    if (value.enabled === false) record.enabled = false
    const keywords = normalizeKeywords(value.keywords)
    if (keywords.length > 0) record.keywords = keywords
    if (Object.keys(record).length > 0) skills[skillName] = record
  }
  const rawPrompt = raw && typeof raw === 'object' && raw.prompt && typeof raw.prompt === 'object' ? raw.prompt : {}
  const disabledSections = Array.isArray(rawPrompt.disabledSections)
    ? [...new Set(rawPrompt.disabledSections.filter((item) => typeof item === 'string' && item.trim().length > 0).map((item) => item.trim()))]
    : []
  return {
    version: 1,
    active: raw?.active !== false,
    injectHints: raw?.injectHints !== false,
    skills,
    prompt: {
      active: rawPrompt.active !== false,
      disabledSections,
      extra: typeof rawPrompt.extra === 'string' ? rawPrompt.extra : '',
    },
  }
}

function createStore(file) {
  let state = normalizeState(null)
  let stamp = -1
  let queue = Promise.resolve()

  async function refresh() {
    try {
      const info = await stat(file)
      if (info.mtimeMs === stamp) return state
      const raw = JSON.parse(await readFile(file, 'utf8'))
      state = normalizeState(raw)
      stamp = info.mtimeMs
    } catch {
      // A missing or unreadable file means "defaults"; keep the last good state.
    }
    return state
  }

  function get() {
    return state
  }

  async function update(mutator) {
    queue = queue.then(async () => {
      const draft = structuredClone(state)
      await mutator(draft)
      const next = normalizeState(draft)
      await mkdir(dirname(file), { recursive: true })
      const temporary = `${file}.tmp-${process.pid}-${Date.now()}`
      await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
      await rename(temporary, file)
      state = next
      try {
        const info = await stat(file)
        stamp = info.mtimeMs
      } catch {
        stamp = -1
      }
      return state
    })
    return queue
  }

  return { get, refresh, update }
}

function skillOverride(state, skillName) {
  return state.skills[skillName] ?? {}
}

function isEnabled(state, skillName) {
  return skillOverride(state, skillName).enabled !== false
}

function splitNameTokens(skillName) {
  return skillName.toLowerCase().split(/[-_.\s]+/).filter((item) => item.length > 1)
}

const STOPWORDS = new Set([
  'and', 'are', 'based', 'build', 'built', 'but', 'can', 'create', 'edit', 'fast', 'for', 'from', 'has',
  'have', 'into', 'its', 'modern', 'not', 'our', 'per', 'read', 'simple', 'that', 'the', 'their', 'this',
  'use', 'using', 'via', 'was', 'when', 'with', 'you', 'your', 'etc', 'all', 'any', 'validate', 'work',
])

function latinWords(text) {
  if (typeof text !== 'string') return []
  return (text.toLowerCase().match(/[a-z][a-z0-9+#.-]{2,}/g) ?? []).filter((word) => !STOPWORDS.has(word))
}

function routingKeywords(state, summary) {
  const explicit = skillOverride(state, summary.name).keywords ?? []
  if (explicit.length > 0) return [...new Set(explicit.map((item) => item.toLowerCase()))]
  const derived = [...splitNameTokens(summary.name), ...latinWords(summary.whenToUse)]
  return [...new Set(derived.filter((item) => item.length > 1))].slice(0, 12)
}

function queryTokens(query) {
  return [...new Set(query.toLowerCase().split(/[^\p{L}\p{N}_+#.-]+/u).filter((item) => item.length > 1))]
}

function scoreSkill(state, summary, tokens, loweredQuery) {
  let score = 0
  const keywords = routingKeywords(state, summary)
  for (const keyword of keywords) {
    if (keyword.length >= 2 && loweredQuery.includes(keyword)) score += Math.min(6, 2 + keyword.length / 3)
    for (const token of tokens) {
      if (keyword === token) score += 2
      else if (keyword.length >= 3 && token.length >= 3 && (keyword.includes(token) || token.includes(keyword))) score += 1.5
    }
  }
  const name = summary.name.toLowerCase()
  const haystack = `${summary.name} ${summary.description ?? ''} ${summary.whenToUse ?? ''}`.toLowerCase()
  for (const token of tokens) {
    if (name === token) score += 10
    else if (name.includes(token)) score += 4
    if (haystack.includes(token)) score += 1
  }
  return score
}

function clip(text, max) {
  if (typeof text !== 'string') return ''
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length <= max ? flat : `${flat.slice(0, Math.max(0, max - 1))}…`
}

function userMessage(text, source) {
  return {
    id: randomUUID(),
    role: 'user',
    content: [{ type: 'text', text }],
    source,
  }
}

/**
 * Remove the full catalog message and any slash-command skill invocation whose
 * skill is disabled in skill-router. Kept pure so it can be unit tested.
 */
export function filterBlockedSkills(state, messages) {
  const blocked = []
  const kept = []
  for (const message of messages) {
    const source = message?.source
    if (source?.kind === CATALOG_SOURCE) continue
    if (source?.kind === 'skill-invocation' && typeof source.name === 'string' && !isEnabled(state, source.name)) {
      blocked.push(source.name)
      continue
    }
    kept.push(message)
  }
  const unique = [...new Set(blocked)]
  if (unique.length > 0) {
    kept.push(userMessage(
      [
        '<system-reminder>',
        `skill-router blocked slash-command skill(s): ${unique.map((item) => `\`${item}\``).join(', ')}.`,
        'They are disabled in the skill-router settings; do not follow their instructions. Use `skill_search` to find an enabled alternative.',
        '</system-reminder>',
      ].join('\n'),
      { kind: HINT_SOURCE, form: 'blocked-invocation', names: unique },
    ))
  }
  return { messages: kept, blocked: unique }
}

function renderSearch(value) {
  const lines = []
  if (value.matches.length === 0) {
    lines.push(`No enabled skill matched "${value.query}". Try different keywords; ${value.totalEnabled} enabled skill(s) are registered.`)
    if (value.disabledMatches.length > 0) lines.push(`Disabled matches: ${value.disabledMatches.join(', ')}.`)
    return lines.join('\n')
  }
  lines.push(`Skills matching "${value.query}" (${value.matches.length} of ${value.totalEnabled} enabled):`)
  for (const match of value.matches) {
    const keywords = match.keywords.length > 0 ? ` [${match.keywords.join(', ')}]` : ''
    lines.push(`- ${match.name} (score ${match.score})${keywords}: ${match.description}`)
  }
  lines.push('Call the `skill` tool with one of these exact names to load its instructions.')
  if (value.disabledMatches.length > 0) lines.push(`Also matched but disabled: ${value.disabledMatches.join(', ')}.`)
  return lines.join('\n')
}

function renderManager(value) {
  return value.message
}

export function apply(ctx, config = {}) {
  const stateFile = typeof config.stateFile === 'string' && config.stateFile.trim() ? config.stateFile.trim() : defaultStateFile()
  const store = createStore(stateFile)
  const hintDigests = new Map()
  let skillCache = { at: 0, agentId: '', skills: [] }
  let lastSections = []

  ctx.logger?.info?.(`[skill-router] state: ${stateFile}`)
  void store.refresh().then((state) => {
    if (!state.active) ctx.logger?.info?.('[skill-router] disabled in state; skill catalog stays as-is')
  }).catch((error) => {
    ctx.logger?.warn?.(`[skill-router] state load failed: ${String(error)}`)
  })

  async function listSkills(exec) {
    if (!ctx.skills) return []
    const agent = exec?.agent
    let cwd
    const workingDirectory = ctx.get?.('workingDirectory')
    if (agent && workingDirectory) {
      try {
        cwd = await workingDirectory.ensure(agent, exec?.signal)
      } catch {
        cwd = undefined
      }
    }
    try {
      return await ctx.skills.list({ cwd, signal: exec?.signal, scope: agent })
    } catch (error) {
      ctx.logger?.warn?.(`[skill-router] skills.list failed: ${String(error)}`)
      return []
    }
  }

  function modelVisible(summary) {
    return summary?.invocation?.modelInvocable === true
  }

  // ---------------------------------------------------------------- prompt --
  ctx.systemPrompt.section({
    name: PROMPT_SECTION,
    order: 950,
    text: () => (store.get().active ? ROUTER_PROMPT : ''),
  })

  ctx.on('system-prompt/assemble', async (assembly, context, next) => {
    const result = await next()
    try {
      lastSections = result.sections.map((section) => ({
        name: section.name,
        characters: typeof section.text === 'string' ? section.text.length : 0,
      }))
    } catch {
      // Keep the previous snapshot; the settings page can still toggle names.
    }
    try {
      const state = await store.refresh()
      if (!state.prompt.active) return result
      const disabled = new Set(state.prompt.disabledSections)
      const sections = result.sections.filter((section) => !disabled.has(section.name))
      const extra = state.prompt.extra.trim()
      if (extra.length > 0 && !sections.some((section) => section.name === EXTRA_SECTION)) {
        sections.push({ name: EXTRA_SECTION, text: extra, interpolate: false })
      }
      return { ...result, sections }
    } catch (error) {
      ctx.logger?.warn?.(`[skill-router] prompt assembly failed: ${String(error)}`)
      return result
    }
  })

  // ------------------------------------------------------------- pre-step --
  ctx.on('agent/pre-step', async (payload, next) => {
    const decision = await next()
    if (!decision || decision.kind !== 'enter') return decision
    try {
      const state = await store.refresh()
      if (!state.active) return decision
      const { messages, blocked } = filterBlockedSkills(state, decision.messages)
      if (blocked.length > 0) {
        ctx.logger?.info?.(`[skill-router] blocked disabled slash-command skill(s): ${blocked.join(', ')}`)
      }
      if (!state.injectHints) return { ...decision, messages }
      const hint = await buildHint(state, payload)
      if (hint !== undefined) messages.push(hint)
      return { ...decision, messages }
    } catch (error) {
      ctx.logger?.warn?.(`[skill-router] pre-step failed: ${String(error)}`)
      return decision
    }
  })

  async function buildHint(state, payload) {
    const input = (payload.messages ?? [])
      .filter((message) => message?.source?.kind === 'user')
      .flatMap((message) => (message.content ?? []).filter((block) => block?.type === 'text').map((block) => block.text))
      .join('\n')
      .trim()
    if (input.length === 0) return undefined

    const lowered = input.toLowerCase()
    const agentId = String(payload.agent?.id ?? '')
    const now = Date.now()
    let skills = skillCache.skills
    if (skillCache.agentId !== agentId || now - skillCache.at > 10_000) {
      skills = await listSkills(payload)
      skillCache = { at: now, agentId, skills }
    }
    const tokens = queryTokens(input)
    const matches = []
    for (const summary of skills) {
      if (!modelVisible(summary) || !isEnabled(state, summary.name)) continue
      const score = scoreSkill(state, summary, tokens, lowered)
      if (score >= 4) matches.push({ name: summary.name, description: clip(summary.description, 90), score })
    }
    matches.sort((left, right) => right.score - left.score)
    const top = matches.slice(0, 3)
    if (top.length === 0) return undefined
    const digest = top.map((match) => match.name).join(',')
    if (hintDigests.get(agentId) === digest) return undefined
    hintDigests.set(agentId, digest)
    const lines = top.map((match) => `\`${match.name}\` — ${match.description}`)
    return userMessage(
      [
        '<system-reminder>',
        'skill-router matched this request to:',
        ...lines,
        'If one applies, call the `skill` tool with its exact name before acting. For anything else, use `skill_search`.',
        '</system-reminder>',
      ].join('\n'),
      { kind: HINT_SOURCE, form: 'hint', entries: top.map((match) => match.name) },
    )
  }

  // -------------------------------------------------------------- web api --
  const API_PREFIX = '/api/skill-router'
  const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

  function pickAgent() {
    try {
      return ctx.get?.('agents')?.list?.()[0]
    } catch {
      return undefined
    }
  }

  function uiStatus() {
    try {
      const modules = ctx.get?.('clientModules')
      const path = modules?.clientPath?.('dsh-skill-router')
      return { composed: Boolean(path), path: path ?? null }
    } catch {
      return { composed: false, path: null }
    }
  }

  // client-modules caches a package's "not a client package" verdict until the
  // process restarts; drop that verdict for this package and recompose so a
  // freshly added ./client bundle reaches the page without a restart.
  function rescanClientBundle() {
    try {
      const modules = ctx.get?.('clientModules')
      if (!modules) return false
      if (modules.clientPath?.('dsh-skill-router')) return true
      if (modules.pkgMeta instanceof Map) {
        for (const key of [...modules.pkgMeta.keys()]) {
          if (String(key).includes('dsh-skill-router')) modules.pkgMeta.delete(key)
        }
      }
      if (modules.dirty instanceof Set) modules.dirty.add('dsh-skill-router')
      modules.flush?.((error) => ctx.logger?.warn?.(`[skill-router] client rescan: ${String(error)}`))
      const composed = Boolean(modules.clientPath?.('dsh-skill-router'))
      if (composed) ctx.logger?.info?.('[skill-router] client bundle composed; settings page is live')
      return composed
    } catch (error) {
      ctx.logger?.warn?.(`[skill-router] client rescan failed: ${String(error)}`)
      return false
    }
  }

  function sectionList(state, agent, signal) {
    const disabled = new Set(state.prompt.disabledSections)
    const sections = lastSections
      .filter((section) => section.name !== EXTRA_SECTION)
      .map((section, index) => ({
        name: section.name,
        characters: section.characters,
        order: index,
        disabled: disabled.has(section.name),
      }))
    for (const name of state.prompt.disabledSections) {
      if (!sections.some((section) => section.name === name)) {
        sections.push({ name, characters: 0, order: sections.length, disabled: true, missing: true })
      }
    }
    return sections
  }

  async function viewState(agent, signal) {
    const state = await store.refresh()
    const skills = (await listSkills({ agent, signal })).map((summary) => {
      const override = skillOverride(state, summary.name)
      return {
        name: summary.name,
        description: clip(summary.description, 200),
        whenToUse: clip(summary.whenToUse, 160),
        keywords: routingKeywords(state, summary),
        customKeywords: (override.keywords ?? []).length > 0,
        enabled: isEnabled(state, summary.name),
        modelInvocable: modelVisible(summary),
        userInvocable: summary?.invocation?.userInvocable === true,
        source: String(summary.source ?? ''),
      }
    })
    skills.sort((left, right) => left.name.localeCompare(right.name))
    return {
      active: state.active,
      injectHints: state.injectHints,
      prompt: {
        active: state.prompt.active,
        disabledSections: state.prompt.disabledSections,
        extra: state.prompt.extra,
      },
      skills,
      sections: sectionList(state, agent, signal),
      statePath: stateFile,
      hasAgent: Boolean(agent),
      ui: uiStatus(),
    }
  }

  function invalidSkill(name) {
    return name.length === 0 || !SKILL_NAME.test(name)
  }

  async function applyAction(action, body) {
    const name = typeof body.skill === 'string' ? body.skill.trim() : ''
    const section = typeof body.section === 'string' ? body.section.trim() : ''
    switch (action) {
      case 'refresh':
        await store.refresh()
        return { ok: true, message: 'State reloaded from disk.' }
      case 'set_active': {
        const active = body.active !== false
        await store.update((draft) => {
          draft.active = active
        })
        return { ok: true, message: active ? 'On-demand skill routing enabled.' : 'Skill routing disabled; the original catalog is restored.' }
      }
      case 'set_hints': {
        const injectHints = body.injectHints !== false
        await store.update((draft) => {
          draft.injectHints = injectHints
        })
        return { ok: true, message: injectHints ? 'Matched-skill hints enabled.' : 'Matched-skill hints disabled.' }
      }
      case 'set_prompt_active': {
        const active = body.active !== false
        await store.update((draft) => {
          draft.prompt.active = active
        })
        return { ok: true, message: active ? 'System-prompt management enabled.' : 'System-prompt management disabled.' }
      }
      case 'toggle_skill': {
        if (invalidSkill(name)) return { ok: false, message: `Invalid skill name: ${name || '(empty)'}` }
        const enabled = body.enabled !== false
        await store.update((draft) => {
          const record = draft.skills[name] ?? (draft.skills[name] = {})
          if (enabled) delete record.enabled
          else record.enabled = false
          if (Object.keys(record).length === 0) delete draft.skills[name]
        })
        return { ok: true, message: `${name} is now ${enabled ? 'enabled' : 'disabled'}.` }
      }
      case 'set_keywords': {
        if (invalidSkill(name)) return { ok: false, message: `Invalid skill name: ${name || '(empty)'}` }
        const keywords = normalizeKeywords(body.keywords)
        await store.update((draft) => {
          const record = draft.skills[name] ?? (draft.skills[name] = {})
          if (keywords.length > 0) record.keywords = keywords
          else delete record.keywords
          if (Object.keys(record).length === 0) delete draft.skills[name]
        })
        return {
          ok: true,
          message: keywords.length > 0 ? `Keywords for ${name}: ${keywords.join(', ')}` : `Using auto-derived keywords for ${name}.`,
        }
      }
      case 'toggle_section': {
        if (section.length === 0 || section.length > 120) return { ok: false, message: 'Invalid prompt section name.' }
        const enabled = body.enabled !== false
        await store.update((draft) => {
          const set = new Set(draft.prompt.disabledSections)
          if (enabled) set.delete(section)
          else set.add(section)
          draft.prompt.disabledSections = [...set]
        })
        return { ok: true, message: `Prompt section "${section}" is now ${enabled ? 'enabled' : 'disabled'}.` }
      }
      case 'set_extra': {
        const extra = typeof body.extra === 'string' ? body.extra : ''
        await store.update((draft) => {
          draft.prompt.extra = extra
        })
        return { ok: true, message: extra.trim().length > 0 ? `Extra prompt saved (${extra.trim().length} chars).` : 'Extra prompt cleared.' }
      }
      case 'rescan_ui': {
        const composed = rescanClientBundle()
        return {
          ok: composed,
          message: composed
            ? 'Settings page bundle composed. Open Settings to see “Skill Router”.'
            : 'The client bundle is still not composed; restart the app once so the settings page can load.',
        }
      }
      default:
        return { ok: false, message: `Unknown action: ${action || '(empty)'}.` }
    }
  }

  function sendJson(res, status, value) {
    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    })
    res.end(JSON.stringify(value))
  }

  function readJsonBody(req) {
    return new Promise((resolve, reject) => {
      const chunks = []
      let size = 0
      req.on('data', (chunk) => {
        size += chunk.length
        if (size > 1_000_000) {
          reject(new Error('Request body too large.'))
          req.destroy()
          return
        }
        chunks.push(chunk)
      })
      req.on('end', () => {
        try {
          resolve(chunks.length > 0 ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {})
        } catch (error) {
          reject(error)
        }
      })
      req.on('error', reject)
    })
  }

  function sameOrigin(req) {
    const origin = req.headers.origin
    if (typeof origin !== 'string' || origin.length === 0) return true
    try {
      return new URL(origin).host === req.headers.host
    } catch {
      return false
    }
  }

  ctx.inject(['webServer'], (scoped) => {
    const handler = async (req, res) => {
      const url = new URL(req.url ?? '/', 'http://localhost')
      try {
        if (req.method === 'GET' && url.pathname === `${API_PREFIX}/state`) {
          sendJson(res, 200, await viewState(pickAgent()))
          return
        }
        if (req.method === 'POST' && url.pathname === `${API_PREFIX}/action`) {
          if (!sameOrigin(req)) {
            sendJson(res, 403, { ok: false, message: 'Cross-origin request refused.' })
            return
          }
          const body = await readJsonBody(req)
          const agent = pickAgent()
          const result = await applyAction(String(body.action ?? '').trim(), body)
          sendJson(res, result.ok ? 200 : 400, { ...result, state: await viewState(agent) })
          return
        }
        sendJson(res, 404, { ok: false, message: 'Not found.' })
      } catch (error) {
        sendJson(res, 500, { ok: false, message: String(error?.message ?? error) })
      }
    }
    scoped.effect(
      () => scoped.webServer.register({ kind: 'prefix', path: API_PREFIX, handler }),
      'skill-router: web api',
    )
  })

  // ---------------------------------------------------------------- tools --
  const searchTool = {
    name: 'skill_search',
    description: 'Search the session skill catalog by keywords and return exact skill names with short descriptions. The full catalog is not preloaded in this session, so use this before loading a skill.',
    parameters: {
      query: {
        type: 'string',
        required: true,
        description: 'Keywords describing the task, for example "vue component testing", "PPT 生成", or "docker deploy".',
      },
      limit: {
        type: 'number',
        description: 'Maximum number of matches to return (default 8, capped at 20).',
      },
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          totalEnabled: { type: 'number' },
          matches: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                description: { type: 'string' },
                keywords: { type: 'array', items: { type: 'string' } },
                score: { type: 'number' },
              },
              required: ['name', 'description', 'keywords', 'score'],
            },
          },
          disabledMatches: { type: 'array', items: { type: 'string' } },
        },
        required: ['query', 'totalEnabled', 'matches', 'disabledMatches'],
      },
      render(_args, value) {
        return [{ type: 'text', text: renderSearch(value) }]
      },
    },
    async execute(args, exec) {
      const state = await store.refresh()
      const skills = (await listSkills(exec)).filter(modelVisible)
      const lowered = args.query.toLowerCase()
      const tokens = queryTokens(args.query)
      const limit = Math.max(1, Math.min(20, Number.isFinite(args.limit) ? Number(args.limit) : 8))
      const enabledMatches = []
      const disabledMatches = []
      for (const summary of skills) {
        const score = scoreSkill(state, summary, tokens, lowered)
        if (score <= 0) continue
        if (!isEnabled(state, summary.name)) {
          disabledMatches.push(summary.name)
          continue
        }
        enabledMatches.push({
          name: summary.name,
          description: clip(summary.description, 240),
          keywords: routingKeywords(state, summary).slice(0, 8),
          score: Math.round(score * 10) / 10,
        })
      }
      enabledMatches.sort((left, right) => right.score - left.score)
      return {
        query: args.query,
        totalEnabled: skills.filter((summary) => isEnabled(state, summary.name)).length,
        matches: enabledMatches.slice(0, limit),
        disabledMatches: disabledMatches.slice(0, 5),
      }
    },
    presentCall(args) {
      return { card: 'generic', title: `Search skills: ${args.query}`, kind: 'search', rawInput: args }
    },
  }

  const managerTool = {
    name: 'skill_manager',
    description: 'Inspect or change skill-router settings for this user: list skills, enable/disable a skill, edit its routing keywords, and enable/disable or extend system-prompt sections. Changes persist under the DSH home directory.',
    parameters: {
      action: {
        type: 'string',
        required: true,
        description: 'One of: list, toggle, keywords, prompt, prompt_toggle, prompt_extra, state, reload.',
      },
      skill: { type: 'string', description: 'Exact skill name for toggle/keywords.' },
      enabled: { type: 'boolean', description: 'Target enabled state for toggle/prompt_toggle.' },
      keywords: { type: 'string', description: 'Comma-separated routing keywords for keywords; empty clears them; omit to get suggestions.' },
      section: { type: 'string', description: 'System-prompt section name for prompt_toggle.' },
      extra: { type: 'string', description: 'Extra system-prompt text for prompt_extra; empty clears it.' },
      query: { type: 'string', description: 'Optional filter for list.' },
      limit: { type: 'number', description: 'Maximum rows for list (default 60, capped at 200).' },
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          action: { type: 'string' },
          ok: { type: 'boolean' },
          message: { type: 'string' },
        },
        required: ['action', 'ok', 'message'],
      },
      render(_args, value) {
        return [{ type: 'text', text: renderManager(value) }]
      },
    },
    async execute(args, exec) {
      const action = String(args.action ?? '').trim()
      const state = await store.refresh()
      if (action === 'reload') {
        const refreshed = await store.update(() => {})
        return { action, ok: true, message: `Reloaded ${stateFile}. active=${refreshed.active}, prompt.active=${refreshed.prompt.active}.` }
      }
      if (action === 'state') {
        return {
          action,
          ok: true,
          message: [
            `state file: ${stateFile}`,
            `active: ${state.active}`,
            `injectHints: ${state.injectHints}`,
            `skill overrides: ${Object.keys(state.skills).length}`,
            `prompt.active: ${state.prompt.active}`,
            `prompt.disabledSections: ${state.prompt.disabledSections.join(', ') || '(none)'}`,
            `prompt.extra: ${state.prompt.extra.trim() ? `${state.prompt.extra.trim().length} chars` : '(empty)'}`,
          ].join('\n'),
        }
      }
      if (action === 'list') {
        const skills = (await listSkills(exec)).filter(modelVisible)
        const filter = typeof args.query === 'string' ? args.query.toLowerCase() : ''
        const limit = Math.max(1, Math.min(200, Number.isFinite(args.limit) ? Number(args.limit) : 60))
        const rows = skills
          .filter((summary) => filter.length === 0 || `${summary.name} ${summary.description ?? ''}`.toLowerCase().includes(filter))
          .slice(0, limit)
          .map((summary) => {
            const keywords = routingKeywords(state, summary)
            return `${isEnabled(state, summary.name) ? '[on] ' : '[off]'} ${summary.name}${keywords.length > 0 ? ` (${keywords.slice(0, 6).join(', ')})` : ''}`
          })
        return { action, ok: true, message: `${rows.length} skill(s):\n${rows.join('\n')}` }
      }
      if (action === 'toggle') {
        const skillName = String(args.skill ?? '').trim()
        if (!skillName) return { action, ok: false, message: '`skill` is required for toggle.' }
        const enabled = args.enabled !== false
        await store.update((draft) => {
          const record = draft.skills[skillName] ?? (draft.skills[skillName] = {})
          if (enabled) delete record.enabled
          else record.enabled = false
          if (Object.keys(record).length === 0) delete draft.skills[skillName]
        })
        return { action, ok: true, message: `${skillName} is now ${enabled ? 'enabled' : 'disabled'}.` }
      }
      if (action === 'keywords') {
        const skillName = String(args.skill ?? '').trim()
        if (!skillName) return { action, ok: false, message: '`skill` is required for keywords.' }
        if (typeof args.keywords !== 'string') {
          const summary = (await listSkills(exec)).find((item) => item.name === skillName)
          if (!summary) return { action, ok: false, message: `Unknown skill: ${skillName}` }
          return { action, ok: true, message: `Suggested keywords for ${skillName}: ${routingKeywords(state, summary).join(', ')}` }
        }
        const keywords = normalizeKeywords(args.keywords)
        await store.update((draft) => {
          const record = draft.skills[skillName] ?? (draft.skills[skillName] = {})
          if (keywords.length > 0) record.keywords = keywords
          else delete record.keywords
          if (Object.keys(record).length === 0) delete draft.skills[skillName]
        })
        return {
          action,
          ok: true,
          message: keywords.length > 0 ? `Keywords for ${skillName}: ${keywords.join(', ')}` : `Cleared keywords for ${skillName}.`,
        }
      }
      if (action === 'prompt') {
        let sections = []
        try {
          const assembly = await ctx.systemPrompt.assemble({ scope: exec?.agent, signal: exec?.signal })
          sections = assembly.sections.map((section) => `${section.name} (${section.text.length} chars)`)
        } catch (error) {
          sections = [`(assemble failed: ${String(error)})`]
        }
        return {
          action,
          ok: true,
          message: [
            `prompt.active: ${state.prompt.active}`,
            `disabledSections: ${state.prompt.disabledSections.join(', ') || '(none)'}`,
            `extra: ${state.prompt.extra.trim() ? `${state.prompt.extra.trim().length} chars` : '(empty)'}`,
            'sections:',
            ...sections.map((line) => `- ${line}`),
          ].join('\n'),
        }
      }
      if (action === 'prompt_toggle') {
        const section = String(args.section ?? '').trim()
        if (!section) return { action, ok: false, message: '`section` is required for prompt_toggle.' }
        const enabled = args.enabled !== false
        await store.update((draft) => {
          const set = new Set(draft.prompt.disabledSections)
          if (enabled) set.delete(section)
          else set.add(section)
          draft.prompt.disabledSections = [...set]
        })
        return { action, ok: true, message: `Prompt section "${section}" is now ${enabled ? 'enabled' : 'disabled'}.` }
      }
      if (action === 'prompt_extra') {
        const extra = typeof args.extra === 'string' ? args.extra : ''
        await store.update((draft) => {
          draft.prompt.extra = extra
        })
        return { action, ok: true, message: extra.trim() ? `Extra prompt set (${extra.trim().length} chars).` : 'Extra prompt cleared.' }
      }
      return { action, ok: false, message: `Unknown action: ${action || '(empty)'}. Use list, toggle, keywords, prompt, prompt_toggle, prompt_extra, state, or reload.` }
    },
    presentCall(args) {
      return { card: 'generic', title: `Skill router: ${args.action}`, kind: 'other', rawInput: args }
    },
  }

  ctx.tools.register(searchTool)
  ctx.tools.register(managerTool)

  ctx.tools.guard((exec) => {
    if (exec.name !== 'skill') return undefined
    const skillName = exec.arguments && typeof exec.arguments === 'object' ? exec.arguments.name : undefined
    if (typeof skillName !== 'string' || skillName.length === 0) return undefined
    const state = store.get()
    if (!state.active) return undefined
    if (state.skills[skillName]?.enabled === false) {
      return `Skill "${skillName}" is disabled in skill-router. Enable it first or pick another skill.`
    }
    return undefined
  })

  ctx.inject(['clientModules'], (scoped) => {
    scoped.effect(() => {
      const timer = setTimeout(() => {
        void rescanClientBundle()
      }, 0)
      return () => clearTimeout(timer)
    }, 'skill-router: client bundle rescan')
  })
}
