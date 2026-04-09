import type {
	AutomationRule,
	CreateAutomationRuleInput,
	UpdateAutomationRuleInput,
	Action,
	ExecutionLogEntry,
} from '../types/automation'

export interface RuleResponse {
	rule: AutomationRule
}

export interface RulesResponse {
	rules: AutomationRule[]
}

export interface LogsResponse {
	logs: ExecutionLogEntry[]
	total: number
	limit: number
	offset: number
}

export interface TestResponse {
	tested: boolean
	matched: boolean
	evaluatedConditions: unknown
	context: Record<string, unknown>
	wouldExecuteActions: Action[]
	evaluationDurationMs: number
	error?: string
}

export interface RunResponse {
	executed: boolean
	matched: boolean
	dryRun: boolean
	evaluatedConditions: unknown
	actionResults: Array<{
		success: boolean
		action: Action
		message?: string
	}>
	evaluationDurationMs: number
	executionDurationMs: number
	totalDurationMs: number
	success: boolean
	error?: string
}

export interface ExamplesResponse {
	examples: Array<{ name: string; condition?: unknown; action?: Action }>
}

// CRUD
export async function getRules(): Promise<RulesResponse> {
	const res = await fetch('/api/automation/rules', { credentials: 'include' })
	if (!res.ok) throw new Error('Failed to fetch rules')
	return res.json()
}

export async function getRule(ruleId: number): Promise<RuleResponse> {
	const res = await fetch(`/api/automation/rules/${ruleId}`, { credentials: 'include' })
	if (!res.ok) throw new Error('Failed to fetch rule')
	return res.json()
}

export async function getRulesByInstance(instanceId: number): Promise<RulesResponse> {
	const res = await fetch(`/api/automation/rules/instance/${instanceId}`, { credentials: 'include' })
	if (!res.ok) throw new Error('Failed to fetch rules')
	return res.json()
}

export async function createRule(input: CreateAutomationRuleInput): Promise<RuleResponse> {
	const res = await fetch('/api/automation/rules', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		credentials: 'include',
		body: JSON.stringify(input),
	})
	if (!res.ok) {
		const data = await res.json().catch(() => ({}))
		throw new Error(data.error || 'Failed to create rule')
	}
	return res.json()
}

export async function updateRule(ruleId: number, input: UpdateAutomationRuleInput): Promise<RuleResponse> {
	const res = await fetch(`/api/automation/rules/${ruleId}`, {
		method: 'PUT',
		headers: { 'Content-Type': 'application/json' },
		credentials: 'include',
		body: JSON.stringify(input),
	})
	if (!res.ok) {
		const data = await res.json().catch(() => ({}))
		throw new Error(data.error || 'Failed to update rule')
	}
	return res.json()
}

export async function deleteRule(ruleId: number): Promise<void> {
	const res = await fetch(`/api/automation/rules/${ruleId}`, {
		method: 'DELETE',
		credentials: 'include',
	})
	if (!res.ok) throw new Error('Failed to delete rule')
}

// Testing & Execution
export async function testRule(
	ruleId: number,
	data: { torrentHash?: string; mockTorrent?: unknown }
): Promise<TestResponse> {
	const res = await fetch(`/api/automation/rules/${ruleId}/test`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		credentials: 'include',
		body: JSON.stringify(data),
	})
	if (!res.ok) {
		const err = await res.json().catch(() => ({}))
		throw new Error(err.error || 'Failed to test rule')
	}
	return res.json()
}

export async function runRule(ruleId: number, data: { torrentHash?: string; dryRun?: boolean }): Promise<RunResponse> {
	const res = await fetch(`/api/automation/rules/${ruleId}/run`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		credentials: 'include',
		body: JSON.stringify(data),
	})
	if (!res.ok) {
		const err = await res.json().catch(() => ({}))
		throw new Error(err.error || 'Failed to run rule')
	}
	return res.json()
}

// Logs
export async function getRuleLogs(ruleId: number, limit = 50, offset = 0): Promise<LogsResponse> {
	const res = await fetch(`/api/automation/rules/${ruleId}/logs?limit=${limit}&offset=${offset}`, {
		credentials: 'include',
	})
	if (!res.ok) throw new Error('Failed to fetch logs')
	return res.json()
}

// Examples
export async function getConditionExamples(): Promise<ExamplesResponse> {
	const res = await fetch('/api/automation/examples/conditions', { credentials: 'include' })
	if (!res.ok) throw new Error('Failed to fetch examples')
	return res.json()
}

export async function getActionExamples(): Promise<ExamplesResponse> {
	const res = await fetch('/api/automation/examples/actions', { credentials: 'include' })
	if (!res.ok) throw new Error('Failed to fetch examples')
	return res.json()
}
