window.__ModuleLoader__.load({
  id: 'dsh-skill-router',
  factory: (require) => {
    const module = { exports: {} }
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useMemo, useState } = React

    const NS = 'dsh-skill-router'
    const API = '/api/skill-router'

    const DICT = {
      zh: {
        nav: '技能路由',
        title: '技能路由',
        subtitle: '技能按需加载，系统提示词按开关装配。完整技能目录不再全量注入上下文。',
        refresh: '刷新',
        loading: '正在读取插件状态…',
        noAgent: '当前没有活跃的 agent，技能列表暂时为空；打开一个会话后刷新即可。',
        errorTitle: '操作失败',
        routing: '按需路由',
        routingOn: '已启用',
        routingOff: '已停用',
        activeLabel: '启用按需技能路由',
        activeHint: '关闭后恢复完整的技能目录，技能搜索与停用开关不再生效。',
        hintsLabel: '注入匹配提示',
        hintsHint: '根据本轮输入自动提示最多 3 个可能相关的技能（不占满目录）。',
        skills: '技能',
        skillsHint: '停用后该技能不会出现在搜索结果、匹配提示和 `/` 菜单加载中。',
        filter: '搜索名称、描述或关键词',
        empty: '没有匹配的技能。',
        auto: '自动关键词',
        custom: '自定义关键词',
        resetKeywords: '恢复自动',
        keywordsPlaceholder: '关键词，用逗号分隔',
        userOnly: '仅用户可调用',
        disabledTag: '已停用',
        prompt: '系统提示词',
        promptHint: '控制各提示词段的装配，并追加一段自定义指令。',
        promptActive: '启用提示词管理',
        promptActiveHint: '关闭后所有提示词段保持原样，自定义追加也不生效。',
        sections: '提示词段',
        sectionsHint: '关闭某段后，下一次请求起不再注入该段。',
        showAll: '展开全部',
        showLess: '收起',
        chars: '字符',
        extra: '追加提示词',
        extraHint: '追加在系统提示词末尾，适合放置团队约定或项目背景。',
        save: '保存',
        saved: '已保存',
        statePath: '状态文件',
        uiPending: '设置页需要重启后才会出现在“设置”中（当前进程已缓存旧的插件清单）。',
        confirmDisable: '停用后完整技能目录会重新注入上下文，确定继续？',
      },
      en: {
        nav: 'Skill Router',
        title: 'Skill Router',
        subtitle: 'Load skills on demand and assemble prompt sections with switches. The full catalog stays out of context.',
        refresh: 'Refresh',
        loading: 'Reading plugin state…',
        noAgent: 'No live agent is available, so the skill list is empty. Open a session and refresh.',
        errorTitle: 'Action failed',
        routing: 'On-demand routing',
        routingOn: 'Enabled',
        routingOff: 'Disabled',
        activeLabel: 'Enable on-demand skill routing',
        activeHint: 'Turning this off restores the full skill catalog; search and skill switches stop applying.',
        hintsLabel: 'Inject matched hints',
        hintsHint: 'Nudge the model toward up to three likely skills for the current input.',
        skills: 'Skills',
        skillsHint: 'Disabled skills disappear from search, hints, and `/` loading.',
        filter: 'Filter by name, description, or keywords',
        empty: 'No matching skill.',
        auto: 'Auto keywords',
        custom: 'Custom keywords',
        resetKeywords: 'Restore auto',
        keywordsPlaceholder: 'Keywords, comma separated',
        userOnly: 'User-only',
        disabledTag: 'Disabled',
        prompt: 'System prompt',
        promptHint: 'Control which prompt sections assemble, and append your own instruction block.',
        promptActive: 'Enable prompt management',
        promptActiveHint: 'Turning this off leaves every section untouched and drops the extra block.',
        sections: 'Prompt sections',
        sectionsHint: 'A disabled section is not injected from the next request on.',
        showAll: 'Show all',
        showLess: 'Show less',
        chars: 'chars',
        extra: 'Extra instruction',
        extraHint: 'Appended to the end of the system prompt; useful for team conventions or project context.',
        save: 'Save',
        saved: 'Saved',
        statePath: 'State file',
        uiPending: 'The settings page appears after a restart: this process cached the old plugin manifest.',
        confirmDisable: 'Disabling restores the full catalog in context. Continue?',
      },
    }

    function words() {
      const lang = String(document.documentElement.lang || navigator.language || 'en').toLowerCase()
      return lang.startsWith('zh') ? DICT.zh : DICT.en
    }

    async function request(path, init) {
      const response = await fetch(`${API}${path}`, {
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json' },
        ...init,
      })
      const text = await response.text()
      let data
      try {
        data = text.length > 0 ? JSON.parse(text) : {}
      } catch {
        data = { ok: false, message: text }
      }
      return data
    }

    function action(name, payload) {
      return request('/action', { method: 'POST', body: JSON.stringify({ action: name, ...(payload ?? {}) }) })
    }

    const S = {
      page: { display: 'flex', flexDirection: 'column', gap: '16px', maxWidth: '960px', paddingBottom: '24px' },
      head: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '16px' },
      title: { margin: 0, fontSize: '18px', fontWeight: 600, color: 'var(--dsw-alias-label-primary)' },
      subtitle: { margin: '6px 0 0', fontSize: '12px', lineHeight: 1.6, color: 'var(--dsw-alias-label-secondary)', maxWidth: '640px' },
      card: {
        border: '1px solid var(--dsw-alias-border-l2)',
        borderRadius: '12px',
        background: 'var(--dsw-alias-bg-layer-2)',
        padding: '16px',
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
      },
      cardHead: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '12px' },
      cardTitle: { margin: 0, fontSize: '14px', fontWeight: 600, color: 'var(--dsw-alias-label-primary)' },
      cardHint: { margin: 0, fontSize: '12px', lineHeight: 1.6, color: 'var(--dsw-alias-label-tertiary)' },
      row: { display: 'flex', alignItems: 'center', gap: '12px' },
      rowBetween: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '16px' },
      label: { fontSize: '13px', color: 'var(--dsw-alias-label-primary)' },
      sub: { fontSize: '12px', color: 'var(--dsw-alias-label-tertiary)', lineHeight: 1.5 },
      button: {
        height: '28px',
        padding: '0 10px',
        borderRadius: '7px',
        border: '1px solid var(--dsw-alias-border-l2)',
        background: 'var(--dsw-alias-bg-layer-1)',
        color: 'var(--dsw-alias-label-secondary)',
        fontSize: '12px',
        cursor: 'pointer',
        fontFamily: 'inherit',
      },
      primaryButton: {
        height: '30px',
        padding: '0 14px',
        borderRadius: '7px',
        border: '1px solid var(--dsw-alias-border-l2)',
        background: 'var(--dsw-alias-state-business-primary)',
        color: 'var(--dsw-alias-label-onbusiness, #fff)',
        fontSize: '12px',
        fontWeight: 500,
        cursor: 'pointer',
        fontFamily: 'inherit',
      },
      input: {
        height: '28px',
        padding: '0 8px',
        borderRadius: '7px',
        border: '1px solid var(--dsw-alias-border-l2)',
        background: 'var(--dsw-alias-bg-layer-1)',
        color: 'var(--dsw-alias-label-primary)',
        fontSize: '12px',
        fontFamily: 'inherit',
        outline: 'none',
      },
      textarea: {
        minHeight: '84px',
        resize: 'vertical',
        padding: '8px 10px',
        borderRadius: '8px',
        border: '1px solid var(--dsw-alias-border-l2)',
        background: 'var(--dsw-alias-bg-layer-1)',
        color: 'var(--dsw-alias-label-primary)',
        fontSize: '12px',
        lineHeight: 1.6,
        fontFamily: 'inherit',
        outline: 'none',
      },
      skillList: { display: 'flex', flexDirection: 'column', gap: '2px', maxHeight: '420px', overflowY: 'auto' },
      skillRow: {
        display: 'grid',
        gridTemplateColumns: 'auto minmax(0, 1fr) minmax(140px, 230px)',
        alignItems: 'center',
        gap: '10px',
        padding: '7px 8px',
        borderRadius: '8px',
      },
      skillName: { fontSize: '12px', fontWeight: 500, color: 'var(--dsw-alias-label-primary)', fontFamily: 'ui-monospace, monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
      badge: {
        display: 'inline-block',
        padding: '0 6px',
        height: '17px',
        lineHeight: '17px',
        borderRadius: '5px',
        fontSize: '10px',
        border: '1px solid var(--dsw-alias-border-l2)',
        color: 'var(--dsw-alias-label-tertiary)',
        marginLeft: '4px',
        verticalAlign: 'middle',
        whiteSpace: 'nowrap',
      },
      badgeBusiness: { borderColor: 'var(--dsw-alias-state-business-primary)', color: 'var(--dsw-alias-state-business-primary)' },
      sectionList: { display: 'flex', flexDirection: 'column', gap: '2px', maxHeight: '360px', overflowY: 'auto' },
      sectionRow: { display: 'flex', alignItems: 'center', gap: '10px', padding: '6px 8px', borderRadius: '8px' },
      sectionName: { flex: 1, fontFamily: 'ui-monospace, monospace', fontSize: '12px', color: 'var(--dsw-alias-label-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
      meta: { fontFamily: 'ui-monospace, monospace', fontSize: '11px', color: 'var(--dsw-alias-label-tertiary)' },
      switchTrack: {
        position: 'relative',
        flex: 'none',
        width: '34px',
        height: '20px',
        padding: 0,
        borderRadius: '999px',
        border: '1px solid var(--dsw-alias-border-l2)',
        background: 'var(--dsw-alias-bg-layer-3)',
        cursor: 'pointer',
        transition: 'background 120ms ease, border-color 120ms ease',
      },
      switchOn: { background: 'var(--dsw-alias-state-business-primary)', borderColor: 'var(--dsw-alias-state-business-primary)' },
      switchKnob: {
        position: 'absolute',
        top: '2px',
        left: '2px',
        width: '14px',
        height: '14px',
        borderRadius: '50%',
        background: 'var(--dsw-alias-bg-layer-1)',
        boxShadow: '0 1px 2px rgba(0,0,0,0.25)',
        transition: 'transform 120ms ease',
      },
      switchKnobOn: { transform: 'translateX(14px)' },
      noticeOk: { fontSize: '12px', color: 'var(--dsw-alias-state-success-primary)' },
      noticeErr: { fontSize: '12px', color: 'var(--dsw-alias-state-error-primary)' },
      banner: {
        padding: '9px 12px',
        borderRadius: '8px',
        border: '1px solid var(--dsw-alias-border-l2)',
        background: 'var(--dsw-alias-bg-layer-1)',
        fontSize: '12px',
        color: 'var(--dsw-alias-state-warning-primary)',
        lineHeight: 1.6,
      },
      errorBanner: {
        padding: '9px 12px',
        borderRadius: '8px',
        border: '1px solid var(--dsw-alias-state-error-primary)',
        background: 'var(--dsw-alias-bg-layer-1)',
        fontSize: '12px',
        color: 'var(--dsw-alias-state-error-primary)',
        lineHeight: 1.6,
        wordBreak: 'break-word',
      },
      empty: { padding: '18px 8px', textAlign: 'center', fontSize: '12px', color: 'var(--dsw-alias-label-tertiary)' },
      divider: { height: '1px', background: 'var(--dsw-alias-border-l1)', margin: '2px 0' },
    }

    function Switch(props) {
      const { checked, onChange, disabled, label } = props
      return h(
        'button',
        {
          type: 'button',
          role: 'switch',
          'aria-checked': checked,
          'aria-label': label,
          disabled,
          onClick: () => onChange(!checked),
          style: {
            ...S.switchTrack,
            ...(checked ? S.switchOn : null),
            ...(disabled ? { opacity: 0.5, cursor: 'not-allowed' } : null),
          },
        },
        h('span', { style: { ...S.switchKnob, ...(checked ? S.switchKnobOn : null) } }),
      )
    }

    function Badge(props) {
      return h('span', { style: { ...S.badge, ...(props.business ? S.badgeBusiness : null) } }, props.children)
    }

    function parseKeywords(text) {
      const seen = new Set()
      const out = []
      for (const part of String(text ?? '').split(/[,，;；]+/)) {
        const word = part.trim().toLowerCase().replace(/\s+/g, ' ')
        if (word.length === 0 || word.length > 48 || seen.has(word)) continue
        seen.add(word)
        out.push(word)
        if (out.length >= 16) break
      }
      return out
    }

    function SkillRow(props) {
      const { skill, t, busy, onToggle, onKeywords } = props
      const [text, setText] = useState(skill.keywords.join(', '))
      const signature = skill.keywords.join('\u0000')
      useEffect(() => {
        setText(skill.keywords.join(', '))
      }, [skill.name, signature])
      const commit = () => {
        const next = parseKeywords(text)
        if (next.join('\u0000') !== signature) onKeywords(skill.name, next)
        else setText(skill.keywords.join(', '))
      }
      return h(
        'div',
        {
          style: { ...S.skillRow, ...(skill.enabled ? null : { opacity: 0.62 }) },
          onMouseEnter: (event) => {
            event.currentTarget.style.background = 'var(--dsw-alias-bg-layer-3)'
          },
          onMouseLeave: (event) => {
            event.currentTarget.style.background = 'transparent'
          },
        },
        h(Switch, { checked: skill.enabled, disabled: busy, label: skill.name, onChange: (value) => onToggle(skill.name, value) }),
        h(
          'div',
          { style: { minWidth: 0, display: 'flex', flexDirection: 'column', gap: '2px' } },
          h(
            'div',
            { style: { display: 'flex', alignItems: 'center', minWidth: 0 } },
            h('span', { style: S.skillName, title: skill.name }, skill.name),
            skill.userInvocable && !skill.modelInvocable ? h(Badge, null, t.userOnly) : null,
            !skill.enabled ? h(Badge, null, t.disabledTag) : null,
          ),
          h(
            'div',
            { style: { ...S.sub, color: 'var(--dsw-alias-label-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, title: skill.description },
            skill.description || '—',
          ),
        ),
        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: '6px' } },
          h('input', {
            value: text,
            placeholder: t.keywordsPlaceholder,
            disabled: busy,
            style: { ...S.input, flex: 1, minWidth: 0 },
            onChange: (event) => setText(event.target.value),
            onBlur: commit,
            onKeyDown: (event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                event.currentTarget.blur()
              }
              if (event.key === 'Escape') {
                setText(skill.keywords.join(', '))
                event.currentTarget.blur()
              }
            },
          }),
          skill.customKeywords
            ? h(
                'button',
                {
                  type: 'button',
                  disabled: busy,
                  title: t.resetKeywords,
                  style: { ...S.button, height: '26px', padding: '0 7px' },
                  onClick: () => onKeywords(skill.name, []),
                },
                '↺',
              )
            : null,
        ),
      )
    }

    function SectionRow(props) {
      const { section, t, busy, onToggle } = props
      return h(
        'div',
        { style: { ...S.sectionRow, ...(section.disabled ? { opacity: 0.62 } : null) } },
        h(Switch, { checked: !section.disabled, disabled: busy, label: section.name, onChange: (value) => onToggle(section.name, value) }),
        h('span', { style: S.sectionName, title: section.name }, section.name),
        h('span', { style: S.meta }, section.missing ? t.disabledTag : `${section.characters} ${t.chars}`),
      )
    }

    function Page() {
      const t = words()
      const [view, setView] = useState(null)
      const [error, setError] = useState('')
      const [notice, setNotice] = useState(null)
      const [busy, setBusy] = useState('')
      const [query, setQuery] = useState('')
      const [extra, setExtra] = useState('')
      const [showAllSections, setShowAllSections] = useState(false)

      const load = useCallback(async () => {
        try {
          const data = await request('/state')
          if (data.ok === false) throw new Error(data.message || 'state failed')
          setView(data)
          setExtra(data.prompt.extra)
          setError('')
        } catch (cause) {
          setError(String(cause && cause.message ? cause.message : cause))
        }
      }, [])

      useEffect(() => {
        void load()
      }, [load])

      const run = useCallback(async (key, name, payload) => {
        setBusy(key)
        setNotice(null)
        try {
          const data = await action(name, payload)
          if (data.state) {
            setView(data.state)
            setExtra(data.state.prompt.extra)
          }
          if (data.ok === false) {
            setError(data.message || 'action failed')
          } else {
            setError('')
            if (data.message) setNotice({ tone: 'ok', text: data.message })
          }
        } catch (cause) {
          setError(String(cause && cause.message ? cause.message : cause))
        } finally {
          setBusy('')
        }
      }, [])

      const skills = view ? view.skills : []
      const enabledCount = useMemo(() => skills.filter((skill) => skill.enabled).length, [skills])
      const filtered = useMemo(() => {
        const needle = query.trim().toLowerCase()
        if (needle.length === 0) return skills
        return skills.filter((skill) => `${skill.name} ${skill.description} ${skill.whenToUse} ${skill.keywords.join(' ')}`.toLowerCase().includes(needle))
      }, [skills, query])
      const sections = view ? view.sections : []
      const visibleSections = showAllSections || sections.length <= 12 ? sections : sections.slice(0, 12)
      const extraDirty = view ? extra !== view.prompt.extra : false

      if (view === null) {
        return h('div', { style: S.page }, h('div', { style: { ...S.card, color: 'var(--dsw-alias-label-tertiary)', fontSize: '12px' } }, error ? `${t.errorTitle}: ${error}` : t.loading))
      }

      return h(
        'div',
        { style: S.page },
        h(
          'div',
          { style: S.head },
          h(
            'div',
            null,
            h('h2', { style: S.title }, t.title),
            h('p', { style: S.subtitle }, t.subtitle),
          ),
          h('button', { type: 'button', style: S.button, disabled: busy.length > 0, onClick: () => void load() }, t.refresh),
        ),
        !view.hasAgent ? h('div', { style: S.banner }, t.noAgent) : null,
        !view.ui.composed ? h('div', { style: S.banner }, t.uiPending) : null,
        error ? h('div', { style: S.errorBanner }, `${t.errorTitle}: ${error}`) : null,

        h(
          'section',
          { style: S.card },
          h(
            'div',
            { style: S.cardHead },
            h('h3', { style: S.cardTitle }, t.routing),
            h('span', { style: { ...S.meta, color: view.active ? 'var(--dsw-alias-state-success-primary)' : 'var(--dsw-alias-label-tertiary)' } }, view.active ? t.routingOn : t.routingOff),
          ),
          h(
            'div',
            { style: S.rowBetween },
            h(
              'div',
              { style: { minWidth: 0 } },
              h('div', { style: S.label }, t.activeLabel),
              h('div', { style: S.sub }, t.activeHint),
            ),
            h(Switch, {
              checked: view.active,
              disabled: busy.length > 0,
              label: t.activeLabel,
              onChange: (value) => {
                if (!value && !window.confirm(t.confirmDisable)) return
                void run('active', 'set_active', { active: value })
              },
            }),
          ),
          h('div', { style: S.divider }),
          h(
            'div',
            { style: S.rowBetween },
            h(
              'div',
              { style: { minWidth: 0 } },
              h('div', { style: S.label }, t.hintsLabel),
              h('div', { style: S.sub }, t.hintsHint),
            ),
            h(Switch, {
              checked: view.injectHints,
              disabled: busy.length > 0 || !view.active,
              label: t.hintsLabel,
              onChange: (value) => void run('hints', 'set_hints', { injectHints: value }),
            }),
          ),
        ),

        h(
          'section',
          { style: S.card },
          h(
            'div',
            { style: S.cardHead },
            h('h3', { style: S.cardTitle }, `${t.skills} · ${enabledCount}/${skills.length}`),
            h('input', {
              value: query,
              placeholder: t.filter,
              style: { ...S.input, width: '260px' },
              onChange: (event) => setQuery(event.target.value),
            }),
          ),
          h('p', { style: S.cardHint }, t.skillsHint),
          h(
            'div',
            { style: S.skillList },
            filtered.length === 0
              ? h('div', { style: S.empty }, t.empty)
              : filtered.map((skill) =>
                  h(SkillRow, {
                    key: skill.name,
                    skill,
                    t,
                    busy: busy.length > 0,
                    onToggle: (name, value) => void run(`skill:${name}`, 'toggle_skill', { skill: name, enabled: value }),
                    onKeywords: (name, keywords) => void run(`keywords:${name}`, 'set_keywords', { skill: name, keywords }),
                  }),
                ),
          ),
        ),

        h(
          'section',
          { style: S.card },
          h(
            'div',
            { style: S.cardHead },
            h('h3', { style: S.cardTitle }, t.prompt),
            h('span', { style: S.meta }, `${sections.length} ${t.sections.toLowerCase()}`),
          ),
          h(
            'div',
            { style: S.rowBetween },
            h(
              'div',
              { style: { minWidth: 0 } },
              h('div', { style: S.label }, t.promptActive),
              h('div', { style: S.sub }, t.promptActiveHint),
            ),
            h(Switch, {
              checked: view.prompt.active,
              disabled: busy.length > 0,
              label: t.promptActive,
              onChange: (value) => void run('prompt_active', 'set_prompt_active', { active: value }),
            }),
          ),
          h('div', { style: S.divider }),
          h('div', { style: S.label }, t.sections),
          h('p', { style: S.cardHint }, t.sectionsHint),
          h(
            'div',
            { style: { ...S.sectionList, opacity: view.prompt.active ? 1 : 0.55 } },
            visibleSections.map((section) =>
              h(SectionRow, {
                key: section.name,
                section,
                t,
                busy: busy.length > 0 || !view.prompt.active,
                onToggle: (name, value) => void run(`section:${name}`, 'toggle_section', { section: name, enabled: value }),
              }),
            ),
          ),
          sections.length > 12
            ? h(
                'button',
                { type: 'button', style: { ...S.button, alignSelf: 'flex-start' }, onClick: () => setShowAllSections((value) => !value) },
                showAllSections ? t.showLess : t.showAll,
              )
            : null,
          h('div', { style: S.divider }),
          h(
            'div',
            { style: { display: 'flex', flexDirection: 'column', gap: '8px' } },
            h('div', { style: S.label }, t.extra),
            h('p', { style: S.cardHint }, t.extraHint),
            h('textarea', {
              value: extra,
              style: S.textarea,
              placeholder: '# Project conventions\n- ...',
              onChange: (event) => setExtra(event.target.value),
            }),
            h(
              'div',
              { style: { display: 'flex', alignItems: 'center', gap: '10px' } },
              h(
                'button',
                {
                  type: 'button',
                  style: { ...S.primaryButton, ...(extraDirty ? null : { opacity: 0.55, cursor: 'default' }) },
                  disabled: !extraDirty || busy.length > 0,
                  onClick: () => void run('extra', 'set_extra', { extra }),
                },
                t.save,
              ),
              extraDirty ? h('span', { style: S.noticeOk }, '•') : h('span', { style: S.meta }, t.saved),
            ),
          ),
        ),

        notice ? h('div', { style: notice.tone === 'ok' ? S.noticeOk : S.noticeErr }, notice.text) : null,
        h('div', { style: S.meta }, `${t.statePath}: ${view.statePath}`),
      )
    }

    function apply(ctx) {
      ctx.slots.inject('settings.section', () =>
        ctx.slots.register({ name: 'settings.section', id: NS, order: 45, label: () => words().nav }, () => h(Page)),
      )
    }

    module.exports = { name: NS, inject: ['slots'], apply }
    return module.exports
  },
})
