import { db, type AutomationRule, type ExecutionLogEntry, type RuleState } from './index'
import type { CreateAutomationRuleInput, UpdateAutomationRuleInput, Action } from '../../types/automation'

// ============================================================================
// Automation Rules CRUD
// ============================================================================

export function createAutomationRule(userId: number, input: CreateAutomationRuleInput): AutomationRule {
	const result = db.run(
		`INSERT INTO automation_rules
			(user_id, instance_id, name, enabled, trigger_type, trigger_config, conditions, actions, execution_order)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		[
			userId,
			input.instanceId,
			input.name,
			input.enabled ? 1 : 0,
			input.triggerType,
			JSON.stringify(input.triggerConfig),
			JSON.stringify(input.conditions),
			JSON.stringify(input.actions),
			input.executionOrder ?? 0,
		]
	)

	const rule = getAutomationRuleById(Number(result.lastInsertRowid))
	if (!rule) throw new Error('Failed to create automation rule')
	return rule
}

export function getAutomationRuleById(ruleId: number): AutomationRule | null {
	return db.query<AutomationRule, [number]>('SELECT * FROM automation_rules WHERE id = ?').get(ruleId)
}

export function getAutomationRulesByUser(userId: number): AutomationRule[] {
	return db
		.query<
			AutomationRule,
			[number]
		>('SELECT * FROM automation_rules WHERE user_id = ? ORDER BY execution_order ASC, id ASC')
		.all(userId)
}

export function getAutomationRulesByInstance(instanceId: number): AutomationRule[] {
	return db
		.query<
			AutomationRule,
			[number]
		>('SELECT * FROM automation_rules WHERE instance_id = ? ORDER BY execution_order ASC, id ASC')
		.all(instanceId)
}

export function getEnabledRulesByTrigger(triggerType: string): AutomationRule[] {
	return db
		.query<
			AutomationRule,
			[string]
		>('SELECT * FROM automation_rules WHERE enabled = 1 AND trigger_type = ? ORDER BY execution_order ASC, id ASC')
		.all(triggerType)
}

export function updateAutomationRule(ruleId: number, input: UpdateAutomationRuleInput): AutomationRule {
	const sets: string[] = []
	const values: (string | number | null)[] = []

	if (input.instanceId !== undefined) {
		sets.push('instance_id = ?')
		values.push(input.instanceId)
	}
	if (input.name !== undefined) {
		sets.push('name = ?')
		values.push(input.name)
	}
	if (input.enabled !== undefined) {
		sets.push('enabled = ?')
		values.push(input.enabled ? 1 : 0)
	}
	if (input.triggerType !== undefined) {
		sets.push('trigger_type = ?')
		values.push(input.triggerType)
	}
	if (input.triggerConfig !== undefined) {
		sets.push('trigger_config = ?')
		values.push(JSON.stringify(input.triggerConfig))
	}
	if (input.conditions !== undefined) {
		sets.push('conditions = ?')
		values.push(JSON.stringify(input.conditions))
	}
	if (input.actions !== undefined) {
		sets.push('actions = ?')
		values.push(JSON.stringify(input.actions))
	}
	if (input.executionOrder !== undefined) {
		sets.push('execution_order = ?')
		values.push(input.executionOrder)
	}

	sets.push('updated_at = unixepoch()')
	values.push(ruleId)

	db.run(`UPDATE automation_rules SET ${sets.join(', ')} WHERE id = ?`, values)

	const rule = getAutomationRuleById(ruleId)
	if (!rule) throw new Error('Rule not found')
	return rule
}

export function deleteAutomationRule(ruleId: number): boolean {
	const result = db.run('DELETE FROM automation_rules WHERE id = ?', [ruleId])
	return result.changes > 0
}

export function incrementExecutionCount(ruleId: number): void {
	db.run(
		'UPDATE automation_rules SET execution_count = execution_count + 1, last_executed = unixepoch() WHERE id = ?',
		[ruleId]
	)
}

// ============================================================================
// Execution Logs
// ============================================================================

export function createExecutionLog(
	ruleId: number,
	instanceId: number,
	data: {
		torrentHash?: string
		torrentName?: string
		triggeredBy: string
		conditionsMatched: boolean
		actionsExecuted: { success: boolean; action: Action; message?: string }[]
		executionDurationMs: number
		error?: string
	}
): ExecutionLogEntry {
	const result = db.run(
		`INSERT INTO automation_execution_logs
			(rule_id, instance_id, torrent_hash, torrent_name, triggered_by, conditions_matched, actions_executed, execution_duration_ms, error_message)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		[
			ruleId,
			instanceId,
			data.torrentHash ?? null,
			data.torrentName ?? null,
			data.triggeredBy,
			data.conditionsMatched ? 1 : 0,
			JSON.stringify(data.actionsExecuted),
			data.executionDurationMs,
			data.error ?? null,
		]
	)

	const log = getExecutionLogById(Number(result.lastInsertRowid))
	if (!log) throw new Error('Failed to create execution log')
	return log
}

export function getExecutionLogById(logId: number): ExecutionLogEntry | null {
	return db.query<ExecutionLogEntry, [number]>('SELECT * FROM automation_execution_logs WHERE id = ?').get(logId)
}

export function getExecutionLogsByRule(ruleId: number, limit = 100, offset = 0): ExecutionLogEntry[] {
	return db
		.query<ExecutionLogEntry, [number, number, number]>(
			`SELECT * FROM automation_execution_logs
			 WHERE rule_id = ?
			 ORDER BY created_at DESC
			 LIMIT ? OFFSET ?`
		)
		.all(ruleId, limit, offset)
}

export function getExecutionLogsByInstance(instanceId: number, limit = 100, offset = 0): ExecutionLogEntry[] {
	return db
		.query<ExecutionLogEntry, [number, number, number]>(
			`SELECT * FROM automation_execution_logs
			 WHERE instance_id = ?
			 ORDER BY created_at DESC
			 LIMIT ? OFFSET ?`
		)
		.all(instanceId, limit, offset)
}

export function getExecutionLogsCountByRule(ruleId: number): number {
	const result = db
		.query<{ count: number }, [number]>('SELECT COUNT(*) as count FROM automation_execution_logs WHERE rule_id = ?')
		.get(ruleId)
	return result?.count ?? 0
}

export function cleanupOldExecutionLogs(maxAgeDays: number): number {
	const cutoff = Math.floor(Date.now() / 1000) - maxAgeDays * 24 * 60 * 60
	const result = db.run('DELETE FROM automation_execution_logs WHERE created_at < ?', [cutoff])
	return result.changes
}

// ============================================================================
// Rule States (дедупликация)
// ============================================================================

export function getRuleState(ruleId: number, torrentHash: string, state: string): RuleState | null {
	return db
		.query<
			RuleState,
			[number, string, string]
		>('SELECT * FROM automation_rule_states WHERE rule_id = ? AND torrent_hash = ? AND state = ?')
		.get(ruleId, torrentHash, state)
}

export function setRuleState(ruleId: number, torrentHash: string, state: 'triggered' | 'processed'): void {
	db.run(
		`INSERT INTO automation_rule_states (rule_id, torrent_hash, state, created_at)
		 VALUES (?, ?, ?, unixepoch())
		 ON CONFLICT(rule_id, torrent_hash, state) DO UPDATE SET created_at = unixepoch()`,
		[ruleId, torrentHash, state]
	)
}

export function deleteRuleState(ruleId: number, torrentHash: string, state: string): void {
	db.run('DELETE FROM automation_rule_states WHERE rule_id = ? AND torrent_hash = ? AND state = ?', [
		ruleId,
		torrentHash,
		state,
	])
}

export function cleanupOldRuleStates(maxAgeDays: number): number {
	const cutoff = Math.floor(Date.now() / 1000) - maxAgeDays * 24 * 60 * 60
	const result = db.run('DELETE FROM automation_rule_states WHERE created_at < ?', [cutoff])
	return result.changes
}

// ============================================================================
// Helpers
// ============================================================================

export function parseRuleActions(rule: AutomationRule): Action[] {
	try {
		return JSON.parse(rule.actions) as Action[]
	} catch {
		return []
	}
}

export function parseRuleConditions(rule: AutomationRule): unknown {
	try {
		return JSON.parse(rule.conditions)
	} catch {
		return {}
	}
}

export function parseTriggerConfig(rule: AutomationRule): Record<string, unknown> {
	try {
		return JSON.parse(rule.trigger_config) as Record<string, unknown>
	} catch {
		return {}
	}
}
