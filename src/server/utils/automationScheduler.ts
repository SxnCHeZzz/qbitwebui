import { db } from '../db'
import type { AutomationRule, Instance } from '../db'
import {
	getEnabledRulesByTrigger,
	parseRuleActions,
	parseTriggerConfig,
	setRuleState,
	getRuleState,
	createExecutionLog,
	incrementExecutionCount,
} from '../db/automation'
import { evaluateRule } from './automationEvaluator'
import { executeActions } from './automationExecutor'
import { loginToQbt } from './qbt'
import { fetchWithTls } from './fetch'
import { log } from './logger'
import type { Torrent, TorrentState } from '../../types/qbittorrent'

// ============================================================================
// Types
// ============================================================================

interface ScheduledRule {
	ruleId: number
	userId: number
	instanceId: number
	timer: ReturnType<typeof setTimeout> | null
	cronExpression: string
	nextRun: number
}

interface TorrentStateSnapshot {
	state: TorrentState
	progress: number
	ratio: number
	uploaded: number
}

// ============================================================================
// State
// ============================================================================

const scheduledCronRules = new Map<number, ScheduledRule>()
const torrentSnapshots = new Map<string, TorrentStateSnapshot>() // key: "instanceId:hash"
const processingRules = new Set<number>()
let checkInterval: ReturnType<typeof setInterval> | null = null
let cleanupInterval: ReturnType<typeof setInterval> | null = null

const CHECK_INTERVAL_MS = 30 * 1000 // Проверка event-триггеров каждые 30 сек
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000 // Cleanup каждый час

// ============================================================================
// Cron Scheduler
// ============================================================================

/**
 * Парсит cron expression и возвращает следующее время выполнения
 * Простая реализация: минута час день_месяца месяц день_недели
 */
function getNextCronRun(cronExpr: string, fromTime: number = Date.now()): number {
	const parts = cronExpr.trim().split(/\s+/)
	if (parts.length < 5) {
		// Некорректный cron — запуск через час
		return Math.floor(fromTime / 1000) + 3600
	}

	const [minute, hour, dayOfMonth, month, dayOfWeek] = parts
	const next = new Date(fromTime)

	// Устанавливаем начало следующей минуты
	next.setSeconds(0, 0)
	next.setMinutes(next.getMinutes() + 1)

	// Пытаемся найти подходящее время (макс 366 дней вперед)
	for (let attempts = 0; attempts < 366 * 24 * 60; attempts++) {
		const currentMin = next.getMinutes()
		const currentHour = next.getHours()
		const currentDate = next.getDate()
		const currentMonth = next.getMonth() + 1 // 1-12
		const currentDayOfWeek = next.getDay() // 0-6

		const matchMinute = matchCronField(minute, currentMin, 0, 59)
		const matchHour = matchCronField(hour, currentHour, 0, 23)
		const matchDayOfMonth = matchCronField(dayOfMonth, currentDate, 1, 31)
		const matchMonth = matchCronField(month, currentMonth, 1, 12)
		const matchDayOfWeek = matchCronField(dayOfWeek, currentDayOfWeek, 0, 6)

		if (matchMinute && matchHour && matchDayOfMonth && matchMonth && matchDayOfWeek) {
			return Math.floor(next.getTime() / 1000)
		}

		next.setMinutes(next.getMinutes() + 1)
	}

	// Fallback — через час
	return Math.floor(fromTime / 1000) + 3600
}

function matchCronField(expr: string, value: number, min: number, _max: number): boolean {
	if (expr === '*') return true

	// Простое число
	const numValue = parseInt(expr)
	if (!isNaN(numValue)) {
		return value === numValue
	}

	// Список: 1,2,3
	if (expr.includes(',')) {
		const parts = expr.split(',').map((p) => parseInt(p.trim()))
		return parts.includes(value)
	}

	// Диапазон: 1-5
	if (expr.includes('-')) {
		const [start, end] = expr.split('-').map((p) => parseInt(p.trim()))
		if (!isNaN(start) && !isNaN(end)) {
			return value >= start && value <= end
		}
	}

	// Шаг: */5
	if (expr.startsWith('*/')) {
		const step = parseInt(expr.slice(2))
		if (!isNaN(step)) {
			return (value - min) % step === 0
		}
	}

	return false
}

function scheduleCronRule(rule: AutomationRule, userId: number): void {
	// Отменяем существующий таймер
	const existing = scheduledCronRules.get(rule.id)
	if (existing?.timer) {
		clearTimeout(existing.timer)
	}

	const config = parseTriggerConfig(rule)
	const cronExpr = config.cron as string | undefined

	if (!cronExpr) {
		log.warn(`[Automation Scheduler] Rule ${rule.id} has no cron expression`)
		return
	}

	const nextRun = getNextCronRun(cronExpr)
	const delayMs = Math.max(0, nextRun * 1000 - Date.now())

	const timer = setTimeout(() => {
		runScheduledRule(rule.id, userId, 'cron')
	}, delayMs)

	scheduledCronRules.set(rule.id, {
		ruleId: rule.id,
		userId,
		instanceId: rule.instance_id,
		timer,
		cronExpression: cronExpr,
		nextRun,
	})

	log.info(
		`[Automation Scheduler] Scheduled rule ${rule.id} ("${rule.name}") at ${new Date(nextRun * 1000).toISOString()}`
	)
}

async function runScheduledRule(ruleId: number, userId: number, triggeredBy: string): Promise<void> {
	if (processingRules.has(ruleId)) {
		log.warn(`[Automation Scheduler] Rule ${ruleId} already processing`)
		return
	}

	const rule = db
		.query<AutomationRule, [number]>('SELECT * FROM automation_rules WHERE id = ? AND enabled = 1')
		.get(ruleId)
	if (!rule) {
		log.info(`[Automation Scheduler] Rule ${ruleId} no longer exists or disabled`)
		scheduledCronRules.delete(ruleId)
		return
	}

	processingRules.add(ruleId)

	try {
		await processRule(rule, userId, triggeredBy)
	} catch (error) {
		log.error(`[Automation Scheduler] Rule ${ruleId} failed: ${error instanceof Error ? error.message : 'Unknown'}`)
	} finally {
		processingRules.delete(ruleId)

		// Перепланируем cron-правило
		if (rule.trigger_type === 'cron') {
			scheduleCronRule(rule, userId)
		}
	}
}

// ============================================================================
// Event-Based Triggers (polling)
// ============================================================================

async function checkEventTriggers(): Promise<void> {
	// Получаем все enabled event-based правила
	const eventTriggers = ['torrent_added', 'torrent_completed', 'state_changed', 'ratio_reached'] as const

	for (const triggerType of eventTriggers) {
		const rules = getEnabledRulesByTrigger(triggerType)

		// Группируем по instance для batch обработки
		const rulesByInstance = new Map<number, AutomationRule[]>()
		for (const rule of rules) {
			const list = rulesByInstance.get(rule.instance_id) ?? []
			list.push(rule)
			rulesByInstance.set(rule.instance_id, list)
		}

		for (const [instanceId, instanceRules] of rulesByInstance) {
			try {
				await checkInstanceEventTriggers(instanceId, instanceRules, triggerType)
			} catch (error) {
				log.error(
					`[Automation Scheduler] Failed to check instance ${instanceId}: ${error instanceof Error ? error.message : 'Unknown'}`
				)
			}
		}
	}
}

async function checkInstanceEventTriggers(
	instanceId: number,
	rules: AutomationRule[],
	triggerType: string
): Promise<void> {
	// Получаем instance
	const instance = db.query<Instance, [number]>('SELECT * FROM instances WHERE id = ?').get(instanceId)
	if (!instance) return

	// Логинимся и получаем торренты
	const loginResult = await loginToQbt({
		url: instance.url,
		qbt_username: instance.qbt_username,
		qbt_password_encrypted: instance.qbt_password_encrypted,
		skip_auth: instance.skip_auth,
	})

	if (!loginResult.success) {
		log.warn(`[Automation Scheduler] Failed to login to instance ${instanceId}`)
		return
	}

	const headers: Record<string, string> = loginResult.cookie ? { Cookie: loginResult.cookie } : {}

	// Получаем список торрентов
	const response = await fetchWithTls(`${instance.url}/api/v2/torrents/info`, { headers })
	if (!response.ok) {
		log.warn(`[Automation Scheduler] Failed to fetch torrents from instance ${instanceId}`)
		return
	}

	const torrents = (await response.json()) as Torrent[]

	// Проверяем каждое правило
	for (const rule of rules) {
		if (processingRules.has(rule.id)) continue

		const user = db.query<{ id: number }, [number]>('SELECT user_id as id FROM instances WHERE id = ?').get(instanceId)
		if (!user) continue

		await checkRuleForEvents(rule, instance, torrents, user.id, triggerType)
	}
}

async function checkRuleForEvents(
	rule: AutomationRule,
	instance: Instance,
	torrents: Torrent[],
	userId: number,
	triggerType: string
): Promise<void> {
	const config = parseTriggerConfig(rule)
	const debounceMs = (config.debounceMs as number) ?? 5000
	const minIntervalSec = (config.minIntervalSec as number) ?? 60

	for (const torrent of torrents) {
		const snapshotKey = `${rule.instance_id}:${torrent.hash}`
		const previousSnapshot = torrentSnapshots.get(snapshotKey)
		const currentSnapshot: TorrentStateSnapshot = {
			state: torrent.state,
			progress: torrent.progress,
			ratio: torrent.ratio,
			uploaded: torrent.uploaded,
		}

		let shouldTrigger = false

		switch (triggerType) {
			case 'torrent_added':
				// Торрент новый (не было в снапшоте)
				if (!previousSnapshot) {
					shouldTrigger = true
				}
				break

			case 'torrent_completed':
				// Прогресс стал 1.0
				if (!previousSnapshot || previousSnapshot.progress < 1) {
					if (torrent.progress >= 1) {
						shouldTrigger = true
					}
				}
				break

			case 'state_changed':
				// Состояние изменилось
				if (previousSnapshot && previousSnapshot.state !== torrent.state) {
					shouldTrigger = true
				}
				break

			case 'ratio_reached':
				// Ratio превысил порог (проверяем через conditions)
				if (previousSnapshot && previousSnapshot.ratio < torrent.ratio) {
					// Проверяем условия — они должны содержать проверку ratio
					const evalResult = evaluateRule(rule, torrent)
					if (evalResult.matched) {
						// Проверяем дедупликацию
						const alreadyProcessed = getRuleState(rule.id, torrent.hash, 'processed')
						if (!alreadyProcessed) {
							shouldTrigger = true
						}
					}
				}
				break
		}

		if (shouldTrigger) {
			// Проверяем дедупликацию
			const alreadyTriggered = getRuleState(rule.id, torrent.hash, 'triggered')
			if (alreadyTriggered) {
				// Проверяем debounce
				const timeSinceTrigger = Date.now() / 1000 - alreadyTriggered.created_at
				if (timeSinceTrigger < debounceMs / 1000) {
					continue
				}
			}

			// Проверяем minInterval
			const lastRun = rule.last_executed
			if (lastRun) {
				const timeSinceLastRun = Date.now() / 1000 - lastRun
				if (timeSinceLastRun < minIntervalSec) {
					continue
				}
			}

			// Отмечаем как triggered
			setRuleState(rule.id, torrent.hash, 'triggered')

			// Выполняем
			processingRules.add(rule.id)
			try {
				await processRuleForTorrent(rule, instance, torrent, userId, triggerType)
			} finally {
				processingRules.delete(rule.id)
			}
		}

		// Обновляем снапшот
		torrentSnapshots.set(snapshotKey, currentSnapshot)
	}
}

// ============================================================================
// Rule Processing
// ============================================================================

async function processRule(rule: AutomationRule, userId: number, triggeredBy: string): Promise<void> {
	log.info(`[Automation] Processing rule ${rule.id} ("${rule.name}") triggered by ${triggeredBy}`)

	const instance = db.query<Instance, [number]>('SELECT * FROM instances WHERE id = ?').get(rule.instance_id)
	if (!instance) {
		throw new Error('Instance not found')
	}

	// Получаем все торренты инстанса
	const loginResult = await loginToQbt({
		url: instance.url,
		qbt_username: instance.qbt_username,
		qbt_password_encrypted: instance.qbt_password_encrypted,
		skip_auth: instance.skip_auth,
	})

	if (!loginResult.success) {
		throw new Error('Failed to login')
	}

	const headers: Record<string, string> = loginResult.cookie ? { Cookie: loginResult.cookie } : {}
	const response = await fetchWithTls(`${instance.url}/api/v2/torrents/info`, { headers })

	if (!response.ok) {
		throw new Error('Failed to fetch torrents')
	}

	const torrents = (await response.json()) as Torrent[]
	const actions = parseRuleActions(rule)

	let processedCount = 0

	for (const torrent of torrents) {
		// Проверяем условия
		const evalResult = evaluateRule(rule, torrent)

		if (!evalResult.matched) {
			continue
		}

		// Выполняем действия
		log.info(`[Automation Scheduler] Executing actions for rule "${rule.name}" on torrent "${torrent.name}"`)
		const execResult = await executeActions(actions, {
			instanceId: rule.instance_id,
			userId,
			instanceUrl: instance.url,
			instanceUsername: instance.qbt_username,
			instancePasswordEncrypted: instance.qbt_password_encrypted,
			skipAuth: !!instance.skip_auth,
			torrent,
			triggeredBy,
			dryRun: false,
		})

		// Логируем
		createExecutionLog(rule.id, rule.instance_id, {
			torrentHash: torrent.hash,
			torrentName: torrent.name,
			triggeredBy,
			conditionsMatched: true,
			actionsExecuted: execResult.actionResults.map((r) => ({
				success: r.success,
				action: r.action,
				message: r.message,
			})),
			executionDurationMs: evalResult.durationMs + execResult.durationMs,
			error: execResult.error,
		})

		// Отмечаем как processed
		setRuleState(rule.id, torrent.hash, 'processed')
		processedCount++
	}

	// Обновляем счетчик
	incrementExecutionCount(rule.id)

	log.info(`[Automation] Rule ${rule.id} processed ${processedCount} torrents`)
}

async function processRuleForTorrent(
	rule: AutomationRule,
	instance: Instance,
	torrent: Torrent,
	userId: number,
	triggeredBy: string
): Promise<void> {
	log.info(`[Automation] Processing rule ${rule.id} for torrent "${torrent.name}" triggered by ${triggeredBy}`)

	// Проверяем условия
	const evalResult = evaluateRule(rule, torrent)

	if (!evalResult.matched) {
		log.info(`[Automation] Conditions did not match for torrent "${torrent.name}"`)
		return
	}

	const actions = parseRuleActions(rule)

	// Выполняем действия
	const execResult = await executeActions(actions, {
		instanceId: rule.instance_id,
		userId,
		instanceUrl: instance.url,
		instanceUsername: instance.qbt_username,
		instancePasswordEncrypted: instance.qbt_password_encrypted,
		skipAuth: !!instance.skip_auth,
		torrent,
		triggeredBy,
		dryRun: false,
	})

	// Логируем
	createExecutionLog(rule.id, rule.instance_id, {
		torrentHash: torrent.hash,
		torrentName: torrent.name,
		triggeredBy,
		conditionsMatched: true,
		actionsExecuted: execResult.actionResults.map((r) => ({
			success: r.success,
			action: r.action,
			message: r.message,
		})),
		executionDurationMs: evalResult.durationMs + execResult.durationMs,
		error: execResult.error,
	})

	// Отмечаем как processed
	setRuleState(rule.id, torrent.hash, 'processed')

	// Обновляем счетчик
	incrementExecutionCount(rule.id)

	log.info(`[Automation] Rule ${rule.id} executed for "${torrent.name}"`)
}

// ============================================================================
// Public API
// ============================================================================

export function startAutomationScheduler(): void {
	log.info('[Automation Scheduler] Starting...')

	// Загружаем cron-правила
	const cronRules = getEnabledRulesByTrigger('cron')
	for (const rule of cronRules) {
		const user = db
			.query<{ user_id: number }, [number]>('SELECT user_id FROM instances WHERE id = ?')
			.get(rule.instance_id)
		if (user) {
			scheduleCronRule(rule, user.user_id)
		}
	}

	// Запускаем проверку event-триггеров
	checkInterval = setInterval(checkEventTriggers, CHECK_INTERVAL_MS)

	// Cleanup старых состояний
	cleanupInterval = setInterval(async () => {
		const { cleanupOldRuleStates, cleanupOldExecutionLogs } = await import('../db/automation')
		const statesCleaned = cleanupOldRuleStates(7) // 7 дней
		const logsCleaned = cleanupOldExecutionLogs(30) // 30 дней
		if (statesCleaned > 0 || logsCleaned > 0) {
			log.info(`[Automation Scheduler] Cleaned ${statesCleaned} states, ${logsCleaned} logs`)
		}
	}, CLEANUP_INTERVAL_MS)

	log.info(`[Automation Scheduler] Started with ${cronRules.length} cron rules`)
}

export function stopAutomationScheduler(): void {
	log.info('[Automation Scheduler] Stopping...')

	if (checkInterval) {
		clearInterval(checkInterval)
		checkInterval = null
	}

	if (cleanupInterval) {
		clearInterval(cleanupInterval)
		cleanupInterval = null
	}

	for (const [, scheduled] of scheduledCronRules) {
		if (scheduled.timer) {
			clearTimeout(scheduled.timer)
		}
	}
	scheduledCronRules.clear()
	torrentSnapshots.clear()
}

export function updateRuleSchedule(ruleId: number, enabled: boolean): void {
	const scheduled = scheduledCronRules.get(ruleId)

	if (!enabled) {
		if (scheduled?.timer) {
			clearTimeout(scheduled.timer)
		}
		scheduledCronRules.delete(ruleId)
		log.info(`[Automation Scheduler] Disabled schedule for rule ${ruleId}`)
		return
	}

	const rule = db.query<AutomationRule, [number]>('SELECT * FROM automation_rules WHERE id = ?').get(ruleId)
	if (!rule || rule.trigger_type !== 'cron') return

	const user = db
		.query<{ user_id: number }, [number]>('SELECT user_id FROM instances WHERE id = ?')
		.get(rule.instance_id)
	if (user) {
		scheduleCronRule(rule, user.user_id)
	}
}

export async function triggerManualRule(ruleId: number, userId: number, _torrentHash?: string): Promise<void> {
	if (processingRules.has(ruleId)) {
		throw new Error('Rule already processing')
	}

	const rule = getEnabledRulesByTrigger('manual').find((r) => r.id === ruleId)
	if (!rule) {
		throw new Error('Rule not found or not enabled')
	}

	await runScheduledRule(ruleId, userId, 'manual')
}

export interface SchedulerStatus {
	ruleId: number
	ruleName: string
	triggerType: string
	enabled: boolean
	nextRun?: number
	isRunning: boolean
}

export function getAutomationSchedulerStatus(): SchedulerStatus[] {
	const rules = db
		.query<AutomationRule & { name: string }, []>('SELECT * FROM automation_rules WHERE enabled = 1')
		.all()

	return rules.map((rule) => {
		const scheduled = scheduledCronRules.get(rule.id)
		return {
			ruleId: rule.id,
			ruleName: rule.name,
			triggerType: rule.trigger_type,
			enabled: !!rule.enabled,
			nextRun: scheduled?.nextRun,
			isRunning: processingRules.has(rule.id),
		}
	})
}
