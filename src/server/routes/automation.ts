import { Hono } from 'hono'
import { authMiddleware } from '../middleware/auth'
import { db, type User, type Instance, type AutomationRule } from '../db'
import {
	createAutomationRule,
	getAutomationRuleById,
	getAutomationRulesByUser,
	updateAutomationRule,
	deleteAutomationRule,
	getAutomationRulesByInstance,
	createExecutionLog,
	getExecutionLogsByRule,
	getExecutionLogsCountByRule,
	parseRuleActions,
	parseTriggerConfig,
	parseRuleConditions,
} from '../db/automation'
import { evaluateRule, validateConditions } from '../utils/automationEvaluator'
import { executeActions, validateActions } from '../utils/automationExecutor'
import { checkRateLimit } from '../utils/rateLimit'
import { log } from '../utils/logger'
import { loginToQbt } from '../utils/qbt'
import { fetchWithTls } from '../utils/fetch'
import type {
	CreateAutomationRuleInput,
	UpdateAutomationRuleInput,
	Action,
	AutomationTriggerType,
} from '../../types/automation'
import type { Torrent } from '../../types/qbittorrent'

const automation = new Hono<{ Variables: { user: User } }>()

automation.use('*', authMiddleware)

// ============================================================================
// Helpers
// ============================================================================

function userOwnsInstance(userId: number, instanceId: number): boolean {
	const instance = db
		.query<{ id: number }, [number, number]>('SELECT id FROM instances WHERE id = ? AND user_id = ?')
		.get(instanceId, userId)
	return !!instance
}

function getInstance(instanceId: number): Instance | null {
	return db.query<Instance, [number]>('SELECT * FROM instances WHERE id = ?').get(instanceId)
}

function formatRuleResponse(rule: AutomationRule) {
	return {
		id: rule.id,
		userId: rule.user_id,
		instanceId: rule.instance_id,
		name: rule.name,
		enabled: !!rule.enabled,
		triggerType: rule.trigger_type,
		triggerConfig: parseTriggerConfig(rule),
		conditions: parseRuleConditions(rule),
		actions: parseRuleActions(rule),
		executionOrder: rule.execution_order,
		lastExecuted: rule.last_executed,
		executionCount: rule.execution_count,
		createdAt: rule.created_at,
		updatedAt: rule.updated_at,
	}
}

function validateRuleInput(body: Record<string, unknown>): { valid: boolean; error?: string } {
	if (!body.name || typeof body.name !== 'string') {
		return { valid: false, error: 'name is required and must be a string' }
	}
	if (body.name.length > 100) {
		return { valid: false, error: 'name too long (max 100)' }
	}
	if (typeof body.instanceId !== 'number') {
		return { valid: false, error: 'instanceId is required' }
	}
	if (!body.triggerType || typeof body.triggerType !== 'string') {
		return { valid: false, error: 'triggerType is required' }
	}
	const validTriggers = ['cron', 'torrent_added', 'torrent_completed', 'state_changed', 'ratio_reached', 'manual']
	if (!validTriggers.includes(body.triggerType)) {
		return { valid: false, error: `triggerType must be one of: ${validTriggers.join(', ')}` }
	}
	if (body.triggerType === 'cron') {
		const config = body.triggerConfig as Record<string, unknown> | undefined
		if (!config?.cron || typeof config.cron !== 'string') {
			return { valid: false, error: 'cron expression required for cron trigger' }
		}
		// Простая валидация cron
		const cronParts = config.cron.split(' ')
		if (cronParts.length < 5) {
			return { valid: false, error: 'invalid cron expression (min 5 parts)' }
		}
	}
	if (!body.conditions || typeof body.conditions !== 'object') {
		return { valid: false, error: 'conditions is required' }
	}
	const conditionsValidation = validateConditions(body.conditions)
	if (!conditionsValidation.valid) {
		return { valid: false, error: `invalid conditions: ${conditionsValidation.error}` }
	}
	if (!Array.isArray(body.actions)) {
		return { valid: false, error: 'actions must be an array' }
	}
	if (body.actions.length === 0) {
		return { valid: false, error: 'at least one action required' }
	}
	const actionsValidation = validateActions(body.actions as Action[])
	if (!actionsValidation.valid) {
		return { valid: false, error: `invalid actions: ${actionsValidation.errors.join(', ')}` }
	}
	if (body.executionOrder !== undefined && typeof body.executionOrder !== 'number') {
		return { valid: false, error: 'executionOrder must be a number' }
	}
	return { valid: true }
}

// ============================================================================
// Routes
// ============================================================================

// GET /api/automation/rules — список всех правил пользователя
automation.get('/rules', (c) => {
	const user = c.get('user')
	const rules = getAutomationRulesByUser(user.id)
	return c.json({ rules: rules.map(formatRuleResponse) })
})

// GET /api/automation/rules/:id — одно правило
automation.get('/rules/:id', (c) => {
	const user = c.get('user')
	const ruleId = parseInt(c.req.param('id'))

	const rule = getAutomationRuleById(ruleId)
	if (!rule || rule.user_id !== user.id) {
		return c.json({ error: 'Rule not found' }, 404)
	}

	return c.json({ rule: formatRuleResponse(rule) })
})

// GET /api/automation/rules/instance/:instanceId — правила инстанса
automation.get('/rules/instance/:instanceId', (c) => {
	const user = c.get('user')
	const instanceId = parseInt(c.req.param('instanceId'))

	if (!userOwnsInstance(user.id, instanceId)) {
		return c.json({ error: 'Instance not found' }, 404)
	}

	const rules = getAutomationRulesByInstance(instanceId)
	return c.json({ rules: rules.map(formatRuleResponse) })
})

// POST /api/automation/rules — создать правило
automation.post('/rules', async (c) => {
	const user = c.get('user')
	const body = await c.req.json().catch(() => ({}))

	// Rate limiting
	const rateLimit = checkRateLimit(`automation:create:${user.id}`)
	if (!rateLimit.allowed) {
		return c.json({ error: 'Rate limit exceeded', retryAfter: rateLimit.retryAfter }, 429)
	}

	// Валидация
	const validation = validateRuleInput(body)
	if (!validation.valid) {
		return c.json({ error: validation.error }, 400)
	}

	// Проверка владения инстансом
	if (!userOwnsInstance(user.id, body.instanceId as number)) {
		return c.json({ error: 'Instance not found' }, 404)
	}

	const input: CreateAutomationRuleInput = {
		instanceId: body.instanceId as number,
		name: body.name as string,
		enabled: body.enabled ?? true,
		triggerType: body.triggerType as AutomationTriggerType,
		triggerConfig: (body.triggerConfig as Record<string, unknown>) ?? {},
		conditions: body.conditions as unknown,
		actions: body.actions as Action[],
		executionOrder: body.executionOrder ?? 0,
	}

	try {
		const rule = createAutomationRule(user.id, input)
		log.info(`[Automation] Rule created: ${rule.name} (ID: ${rule.id}) by user ${user.id}`)
		return c.json({ rule: formatRuleResponse(rule) }, 201)
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Failed to create rule'
		log.error(`[Automation] Failed to create rule: ${message}`)
		return c.json({ error: message }, 500)
	}
})

// PUT /api/automation/rules/:id — обновить правило
automation.put('/rules/:id', async (c) => {
	const user = c.get('user')
	const ruleId = parseInt(c.req.param('id'))
	const body = await c.req.json().catch(() => ({}))

	const rule = getAutomationRuleById(ruleId)
	if (!rule || rule.user_id !== user.id) {
		return c.json({ error: 'Rule not found' }, 404)
	}

	// Если меняется instanceId — проверяем права
	if (body.instanceId !== undefined && body.instanceId !== rule.instance_id) {
		if (!userOwnsInstance(user.id, body.instanceId as number)) {
			return c.json({ error: 'Instance not found' }, 404)
		}
	}

	const input: UpdateAutomationRuleInput = {}
	if (body.name !== undefined) input.name = body.name as string
	if (body.enabled !== undefined) input.enabled = body.enabled as boolean
	if (body.triggerType !== undefined) input.triggerType = body.triggerType as AutomationTriggerType
	if (body.triggerConfig !== undefined) input.triggerConfig = body.triggerConfig as Record<string, unknown>
	if (body.conditions !== undefined) {
		const condValidation = validateConditions(body.conditions)
		if (!condValidation.valid) {
			return c.json({ error: `invalid conditions: ${condValidation.error}` }, 400)
		}
		input.conditions = body.conditions as unknown
	}
	if (body.actions !== undefined) {
		if (!Array.isArray(body.actions)) {
			return c.json({ error: 'actions must be an array' }, 400)
		}
		const actValidation = validateActions(body.actions as Action[])
		if (!actValidation.valid) {
			return c.json({ error: `invalid actions: ${actValidation.errors.join(', ')}` }, 400)
		}
		input.actions = body.actions as Action[]
	}
	if (body.executionOrder !== undefined) input.executionOrder = body.executionOrder as number
	if (body.instanceId !== undefined) input.instanceId = body.instanceId as number

	try {
		const updated = updateAutomationRule(ruleId, input)
		log.info(`[Automation] Rule updated: ${updated.name} (ID: ${updated.id})`)
		return c.json({ rule: formatRuleResponse(updated) })
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Failed to update rule'
		return c.json({ error: message }, 500)
	}
})

// DELETE /api/automation/rules/:id — удалить правило
automation.delete('/rules/:id', (c) => {
	const user = c.get('user')
	const ruleId = parseInt(c.req.param('id'))

	const rule = getAutomationRuleById(ruleId)
	if (!rule || rule.user_id !== user.id) {
		return c.json({ error: 'Rule not found' }, 404)
	}

	const deleted = deleteAutomationRule(ruleId)
	if (deleted) {
		log.info(`[Automation] Rule deleted: ${rule.name} (ID: ${ruleId})`)
		return c.json({ success: true })
	}
	return c.json({ error: 'Failed to delete rule' }, 500)
})

// POST /api/automation/rules/:id/test — протестировать на торренте
automation.post('/rules/:id/test', async (c) => {
	const user = c.get('user')
	const ruleId = parseInt(c.req.param('id'))
	const body = await c.req.json().catch(() => ({}))

	const rule = getAutomationRuleById(ruleId)
	if (!rule || rule.user_id !== user.id) {
		return c.json({ error: 'Rule not found' }, 404)
	}

	// Rate limiting для тестов
	const rateLimit = checkRateLimit(`automation:test:${user.id}`)
	if (!rateLimit.allowed) {
		return c.json({ error: 'Rate limit exceeded', retryAfter: rateLimit.retryAfter }, 429)
	}

	// Получаем торрент по хешу или используем переданные данные
	let torrent: Torrent | undefined
	if (body.torrentHash) {
		// Получаем торрент из qBittorrent
		const instance = getInstance(rule.instance_id)
		if (instance) {
			torrent = await fetchTorrentFromInstance(instance, body.torrentHash as string)
		}
	}

	if (!torrent) {
		// Mock данные для тестирования
		torrent = body.mockTorrent as Torrent | undefined
		if (!torrent) {
			return c.json({ error: 'torrentHash or mockTorrent required' }, 400)
		}
	}

	// Тестируем условия
	const evalResult = evaluateRule(rule, torrent)

	// Проверяем, какие действия бы выполнились
	const wouldExecuteActions = evalResult.matched ? parseRuleActions(rule) : []

	return c.json({
		tested: true,
		matched: evalResult.matched,
		evaluatedConditions: evalResult.condition,
		context: evalResult.context,
		wouldExecuteActions: evalResult.matched ? wouldExecuteActions.map((a) => ({ ...a, _dryRun: true })) : [],
		evaluationDurationMs: evalResult.durationMs,
		error: evalResult.error,
	})
})

// POST /api/automation/rules/:id/run — принудительно выполнить правило
automation.post('/rules/:id/run', async (c) => {
	const user = c.get('user')
	const ruleId = parseInt(c.req.param('id'))
	const body = await c.req.json().catch(() => ({}))

	const rule = getAutomationRuleById(ruleId)
	if (!rule || rule.user_id !== user.id) {
		return c.json({ error: 'Rule not found' }, 404)
	}

	// Rate limiting
	const rateLimit = checkRateLimit(`automation:run:${user.id}`)
	if (!rateLimit.allowed) {
		return c.json({ error: 'Rate limit exceeded', retryAfter: rateLimit.retryAfter }, 429)
	}

	const dryRun = body.dryRun === true

	// Получаем инстанс
	const instance = getInstance(rule.instance_id)
	if (!instance) {
		return c.json({ error: 'Instance not found' }, 404)
	}

	// Получаем торрент по хешу или все торренты из инстанса
	let torrents: Torrent[] = []
	if (body.torrentHash) {
		const torrent = await fetchTorrentFromInstance(instance, body.torrentHash as string)
		if (torrent) {
			torrents = [torrent]
		}
	} else {
		// Получаем все торренты из инстанса
		torrents = await fetchTorrentsFromInstance(instance)
	}

	if (torrents.length === 0) {
		return c.json({ error: 'No torrents found in instance' }, 400)
	}

	log.info(
		`[Automation API] Rule ${ruleId} executing in ${dryRun ? 'DRY RUN' : 'NORMAL'} mode for ${torrents.length} torrent(s)`
	)

	const actions = parseRuleActions(rule)
	const allResults: Array<{
		torrentHash: string
		torrentName: string
		matched: boolean
		actionResults: Array<{ success: boolean; action: Action; message?: string }>
	}> = []
	let totalEvalDuration = 0
	let totalExecDuration = 0
	let anyMatched = false
	let allSuccess = true

	// Обрабатываем каждый торрент
	for (const torrent of torrents) {
		// Оцениваем условия
		const evalStart = performance.now()
		const evalResult = evaluateRule(rule, torrent)
		totalEvalDuration += Math.round(performance.now() - evalStart)

		if (!evalResult.matched) {
			allResults.push({
				torrentHash: torrent.hash,
				torrentName: torrent.name,
				matched: false,
				actionResults: [],
			})
			continue
		}

		anyMatched = true

		// Выполняем действия
		const execResult = await executeActions(actions, {
			instanceId: rule.instance_id,
			userId: user.id,
			instanceUrl: instance.url,
			instanceUsername: instance.qbt_username,
			instancePasswordEncrypted: instance.qbt_password_encrypted,
			skipAuth: !!instance.skip_auth,
			torrent,
			triggeredBy: 'manual',
			dryRun,
		})
		totalExecDuration += execResult.durationMs

		if (!execResult.success) {
			allSuccess = false
		}

		allResults.push({
			torrentHash: torrent.hash,
			torrentName: torrent.name,
			matched: true,
			actionResults: execResult.actionResults,
		})

		// Логируем выполнение (только если не dryRun)
		if (!dryRun) {
			try {
				createExecutionLog(ruleId, rule.instance_id, {
					torrentHash: torrent.hash,
					torrentName: torrent.name,
					triggeredBy: 'manual',
					conditionsMatched: true,
					actionsExecuted: execResult.actionResults.map((r) => ({
						success: r.success,
						action: r.action,
						message: r.message,
					})),
					executionDurationMs: evalResult.durationMs + execResult.durationMs,
					error: execResult.error,
				})
			} catch (e) {
				log.error(`[Automation] Failed to log execution: ${e instanceof Error ? e.message : 'Unknown'}`)
			}
		}
	}

	// Формируем единый ответ с actionResults (совместимый с UI)
	// Объединяем все actionResults из всех торрентов
	const combinedActionResults: Array<{ success: boolean; action: Action; message?: string }> = []
	for (const result of allResults) {
		if (result.matched && result.actionResults.length > 0) {
			combinedActionResults.push(...result.actionResults)
		}
	}

	return c.json({
		executed: true,
		matched: anyMatched,
		dryRun,
		actionResults: combinedActionResults,
		evaluatedConditions: evaluateRule(rule, torrents[0]).condition,
		evaluationDurationMs: totalEvalDuration,
		executionDurationMs: totalExecDuration,
		totalDurationMs: totalEvalDuration + totalExecDuration,
		success: allSuccess,
		torrentsProcessed: allResults.length,
		torrentsMatched: allResults.filter((r) => r.matched).length,
		results: allResults,
	})
})

// GET /api/automation/rules/:id/logs — логи выполнения правила
automation.get('/rules/:id/logs', async (c) => {
	const user = c.get('user')
	const ruleId = parseInt(c.req.param('id'))
	const limit = parseInt(c.req.query('limit') || '50')
	const offset = parseInt(c.req.query('offset') || '0')

	const rule = getAutomationRuleById(ruleId)
	if (!rule || rule.user_id !== user.id) {
		return c.json({ error: 'Rule not found' }, 404)
	}

	const logs = getExecutionLogsByRule(ruleId, Math.min(limit, 100), offset)
	const total = getExecutionLogsCountByRule(ruleId)

	return c.json({
		logs: logs.map((l) => ({
			id: l.id,
			ruleId: l.rule_id,
			instanceId: l.instance_id,
			torrentHash: l.torrent_hash,
			torrentName: l.torrent_name,
			triggeredBy: l.triggered_by,
			conditionsMatched: !!l.conditions_matched,
			actionsExecuted: l.actions_executed ? JSON.parse(l.actions_executed) : [],
			executionDurationMs: l.execution_duration_ms,
			errorMessage: l.error_message,
			createdAt: l.created_at,
		})),
		total,
		limit,
		offset,
	})
})

// GET /api/automation/examples/conditions — примеры условий
automation.get('/examples/conditions', async (c) => {
	const { getExampleConditions } = await import('../utils/automationEvaluator')
	return c.json({ examples: getExampleConditions() })
})

// GET /api/automation/examples/actions — примеры действий
automation.get('/examples/actions', async (c) => {
	const { getExampleActions } = await import('../utils/automationExecutor')
	return c.json({ examples: getExampleActions() })
})

// ============================================================================
// Helper: получение торрента из инстанса
// ============================================================================

async function fetchTorrentFromInstance(instance: Instance, hash: string): Promise<Torrent | undefined> {
	const torrents = await fetchTorrentsFromInstance(instance)
	return torrents.find((t) => t.hash === hash)
}

async function fetchTorrentsFromInstance(instance: Instance): Promise<Torrent[]> {
	try {
		const loginResult = await loginToQbt(
			{
				url: instance.url,
				qbt_username: instance.qbt_username,
				qbt_password_encrypted: instance.qbt_password_encrypted,
				skip_auth: instance.skip_auth,
			},
			10000
		)

		if (!loginResult.success) {
			log.error(`[Automation] Failed to login to instance ${instance.id}`)
			return []
		}

		const headers: Record<string, string> = loginResult.cookie ? { Cookie: loginResult.cookie } : {}
		const response = await fetchWithTls(`${instance.url}/api/v2/torrents/info`, { headers })

		if (!response.ok) {
			log.error(`[Automation] Failed to fetch torrents from instance ${instance.id}: HTTP ${response.status}`)
			return []
		}

		const torrents = (await response.json()) as Torrent[]
		return torrents
	} catch (error) {
		log.error(
			`[Automation] Error fetching torrents from instance ${instance.id}: ${error instanceof Error ? error.message : 'Unknown'}`
		)
		return []
	}
}

export { automation }
