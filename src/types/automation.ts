import type { RulesLogic } from 'json-logic-js'

// Триггеры правил
export type AutomationTriggerType =
	| 'cron' // Периодическая проверка
	| 'torrent_added' // Добавление нового торрента
	| 'torrent_completed' // Завершение загрузки
	| 'state_changed' // Изменение состояния
	| 'ratio_reached' // Достижение ratio
	| 'manual' // Ручной запуск

// Конфигурация триггера
export interface TriggerConfig {
	cron?: string // Cron expression для типа 'cron'
	debounceMs?: number // Debounce для event-based триггеров
	minIntervalSec?: number // Минимальный интервал между запусками
}

// Типы условий (используем json-logic-js)
// Данные торрента доступны через переменные: { "var": "torrent.field" }
// Например: { "==": [{ "var": "torrent.state" }, "completed"] }
// или: { ">": [{ "var": "torrent.ratio" }, 1.5] }
export type Condition = RulesLogic

// Типы действий
export type ActionType =
	| 'set_category'
	| 'add_tag'
	| 'remove_tag'
	| 'set_upload_limit'
	| 'set_download_limit'
	| 'pause'
	| 'resume'
	| 'delete'
	| 'move'
	| 'set_priority'
	| 'webhook'
	| 'command'

// Действие
export interface Action {
	type: ActionType
	// Для set_category
	category?: string
	// Для add_tag/remove_tag
	tag?: string
	// Для set_upload_limit/set_download_limit (bytes/s, 0 = unlimited)
	limit?: number
	// Для delete
	deleteFiles?: boolean
	// Для move
	destination?: string
	// Для set_priority (0-7)
	priority?: number
	// Для webhook
	url?: string
	method?: 'GET' | 'POST' | 'PUT'
	headers?: Record<string, string>
	body?: string
	// Для command
	cmd?: string
	args?: string[]
	timeout?: number // ms, default 30000
}

// Правило автоматизации
export interface AutomationRule {
	id: number
	userId: number
	instanceId: number
	name: string
	enabled: boolean
	triggerType: AutomationTriggerType
	triggerConfig: TriggerConfig
	conditions: Condition
	actions: Action[]
	executionOrder: number
	lastExecuted?: number
	executionCount: number
	createdAt: number
	updatedAt: number
}

// Данные торрента для оценки условий (передаётся в json-logic)
export interface TorrentContext {
	hash: string
	name: string
	size: number
	progress: number
	dlspeed: number
	upspeed: number
	priority: number
	num_seeds: number
	num_leechs: number
	ratio: number
	state: string
	category: string
	tags: string[]
	added_on: number
	completion_on: number
	last_activity: number
	seeding_time: number
	tracker: string
	uploaded: number
	downloaded: number
	save_path: string
	isPrivate?: boolean
}

// Результат выполнения действия
export interface ActionResult {
	success: boolean
	action: Action
	message?: string
	data?: unknown
}

// Результат выполнения правила
export interface RuleExecutionResult {
	ruleId: number
	ruleName: string
	torrentHash?: string
	torrentName?: string
	triggeredBy: string
	conditionsMatched: boolean
	actionsExecuted: ActionResult[]
	executionDurationMs: number
	error?: string
	timestamp: number
}

// Запись в логе выполнения
export interface ExecutionLogEntry {
	id: number
	ruleId: number
	instanceId: number
	torrentHash: string | null
	torrentName: string | null
	triggeredBy: string
	conditionsMatched: number // SQLite boolean
	actionsExecuted: string // JSON
	executionDurationMs: number
	errorMessage: string | null
	createdAt: number
}

// Состояние обработки торрента (дедупликация)
export interface RuleState {
	id: number
	ruleId: number
	torrentHash: string
	state: 'triggered' | 'processed'
	createdAt: number
}

// Статус планировщика
export interface AutomationSchedulerStatus {
	rulesCount: number
	enabledRules: number
	nextCronRuns: Array<{
		ruleId: number
		ruleName: string
		nextRun: number
	}>
}

// Данные для создания/обновления правила
export interface CreateAutomationRuleInput {
	instanceId: number
	name: string
	enabled: boolean
	triggerType: AutomationTriggerType
	triggerConfig: Record<string, unknown>
	conditions: unknown
	actions: Action[]
	executionOrder: number
}

export interface UpdateAutomationRuleInput {
	instanceId?: number
	name?: string
	enabled?: boolean
	triggerType?: AutomationTriggerType
	triggerConfig?: Record<string, unknown>
	conditions?: unknown
	actions?: Action[]
	executionOrder?: number
}

// Тестирование правила
export interface TestRuleInput {
	rule: Omit<AutomationRule, 'id' | 'userId' | 'lastExecuted' | 'executionCount' | 'createdAt' | 'updatedAt'>
	torrentHash: string
}

// Результат выполнения действия (для executor)
export interface ActionResult {
	success: boolean
	action: Action
	message?: string
	data?: unknown
}

export interface TestRuleResult {
	matched: boolean
	evaluatedConditions: unknown
	wouldExecuteActions: Action[]
	executionDurationMs: number
}

// Экспорт/импорт
export interface ExportedRules {
	version: string
	exportedAt: string
	rules: Array<
		Omit<AutomationRule, 'id' | 'userId' | 'lastExecuted' | 'executionCount' | 'createdAt' | 'updatedAt'> & {
			instanceLabel?: string
		}
	>
}
