import { useState, useEffect, useCallback } from 'react'
import {
	Plus,
	Play,
	Pause,
	Trash2,
	Pencil,
	History,
	TestTube,
	Clock,
	Zap,
	CheckCircle,
	ChevronRight,
	ChevronDown,
	Settings,
	Download,
	Upload,
} from 'lucide-react'
import type { Instance } from '../api/instances'
import type { AutomationRule, Action } from '../types/automation'
import {
	getRulesByInstance,
	createRule,
	updateRule,
	deleteRule,
	runRule,
	getConditionExamples,
	getActionExamples,
} from '../api/automation'
import { AutomationRuleBuilder } from './AutomationRuleBuilder'
import { AutomationRuleTester } from './AutomationRuleTester'
import { AutomationLogsViewer } from './AutomationLogsViewer'
import { useToast } from '../hooks/useToast'
import { ToastContainer } from './ToastContainer'

interface Props {
	instances: Instance[]
}

const triggerLabels: Record<string, string> = {
	cron: 'Scheduled (Cron)',
	torrent_added: 'Torrent Added',
	torrent_completed: 'Torrent Completed',
	state_changed: 'State Changed',
	ratio_reached: 'Ratio Reached',
	manual: 'Manual Only',
}

const triggerIcons: Record<string, typeof Clock> = {
	cron: Clock,
	torrent_added: Plus,
	torrent_completed: CheckCircle,
	state_changed: Zap,
	ratio_reached: CheckCircle,
	manual: Settings,
}

export function AutomationManager({ instances }: Props) {
	const [rules, setRules] = useState<AutomationRule[]>([])
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState('')
	const [selectedInstance, setSelectedInstance] = useState<number | 'all'>('all')
	const [expandedRule, setExpandedRule] = useState<number | null>(null)

	// Modals
	const [showBuilder, setShowBuilder] = useState(false)
	const [editingRule, setEditingRule] = useState<AutomationRule | null>(null)
	const [testingRule, setTestingRule] = useState<AutomationRule | null>(null)
	const [viewingLogs, setViewingLogs] = useState<AutomationRule | null>(null)
	const [deleteConfirm, setDeleteConfirm] = useState<AutomationRule | null>(null)

	// Examples
	const [conditionExamples, setConditionExamples] = useState<Array<{ name: string; condition: unknown }>>([])
	const [actionExamples, setActionExamples] = useState<Array<{ name: string; action: Action }>>([])

	// Toast notifications
	const { toasts, addToast, removeToast } = useToast()

	const loadRules = useCallback(async () => {
		try {
			setLoading(true)
			if (selectedInstance === 'all') {
				// Получаем все правила из всех инстансов
				const allRules: AutomationRule[] = []
				for (const instance of instances) {
					try {
						const res = await getRulesByInstance(instance.id)
						allRules.push(...res.rules)
					} catch {
						// Игнорируем ошибки для отдельных инстансов
					}
				}
				setRules(allRules)
			} else {
				const res = await getRulesByInstance(selectedInstance)
				setRules(res.rules)
			}
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Failed to load rules')
		} finally {
			setLoading(false)
		}
	}, [selectedInstance, instances])

	useEffect(() => {
		loadRules()
	}, [loadRules])

	useEffect(() => {
		// Загружаем примеры
		Promise.all([getConditionExamples(), getActionExamples()])
			.then(([condRes, actRes]) => {
				setConditionExamples(condRes.examples.map((e) => ({ name: e.name, condition: e.condition })))
				setActionExamples(actRes.examples.map((e) => ({ name: e.name, action: e.action! })))
			})
			.catch(() => {})
	}, [])

	async function handleToggleEnabled(rule: AutomationRule) {
		try {
			await updateRule(rule.id, { enabled: !rule.enabled })
			await loadRules()
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Failed to update rule')
		}
	}

	async function handleDelete() {
		if (!deleteConfirm) return
		try {
			await deleteRule(deleteConfirm.id)
			setDeleteConfirm(null)
			await loadRules()
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Failed to delete rule')
		}
	}

	async function handleRunRule(rule: AutomationRule, dryRun = true) {
		try {
			// Для примера используем dryRun
			const result = await runRule(rule.id, { dryRun })
			if (result.matched) {
				addToast(`Rule executed! Matched: ${result.matched}, Actions: ${result.actionResults.length}`, 'success')
			} else {
				addToast('Conditions did not match', 'info')
			}
			await loadRules()
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Failed to run rule')
		}
	}

	/**
	 * Export rules to JSON file
	 */
	function exportRules(rulesToExport: AutomationRule[]) {
		const exportData = {
			version: '1.0',
			exportedAt: new Date().toISOString(),
			rules: rulesToExport.map((rule) => ({
				name: rule.name,
				instanceId: rule.instanceId,
				triggerType: rule.triggerType,
				triggerConfig: rule.triggerConfig,
				conditions: rule.conditions,
				actions: rule.actions,
				executionOrder: rule.executionOrder,
				enabled: rule.enabled,
			})),
		}

		const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' })
		const url = URL.createObjectURL(blob)
		const a = document.createElement('a')
		a.href = url
		a.download = `automation-rules-${new Date().toISOString().split('T')[0]}.json`
		a.click()
		URL.revokeObjectURL(url)
	}

	/**
	 * Import rules from JSON file
	 */
	async function handleImport(file: File | undefined) {
		if (!file) return

		try {
			const text = await file.text()
			const data = JSON.parse(text)

			if (!data.rules || !Array.isArray(data.rules)) {
				setError('Invalid JSON format: rules array not found')
				return
			}

			// Import each rule
			let importedCount = 0
			for (const ruleData of data.rules) {
				try {
					await createRule({
						name: ruleData.name + ' (Imported)',
						instanceId: ruleData.instanceId,
						triggerType: ruleData.triggerType,
						triggerConfig: ruleData.triggerConfig || {},
						conditions: ruleData.conditions,
						actions: ruleData.actions,
						executionOrder: ruleData.executionOrder || 0,
						enabled: false, // Import as disabled for safety
					})
					importedCount++
				} catch (err) {
					console.error('Failed to import rule:', err)
				}
			}

			await loadRules()
			addToast(`Successfully imported ${importedCount} rules`, 'success')
		} catch (err) {
			setError(err instanceof Error ? err.message : 'Failed to import rules')
			addToast(err instanceof Error ? err.message : 'Failed to import rules', 'error')
		}
	}

	const filteredRules = rules

	if (loading) {
		return (
			<div className="flex items-center justify-center h-64">
				<div className="text-sm" style={{ color: 'var(--text-muted)' }}>
					Loading automation rules...
				</div>
			</div>
		)
	}

	return (
		<div className="space-y-6">
			{/* Header */}
			<div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-0">
				<div>
					<h2 className="text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>
						Automation Rules
					</h2>
					<p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>
						Create rules to automatically manage torrents based on conditions
					</p>
				</div>
				<div className="flex items-center gap-2">
					<button
						onClick={() => exportRules(filteredRules)}
						className="flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm border"
						style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
						title="Export rules to JSON"
					>
						<Download className="w-4 h-4" />
						Export
					</button>
					<label
						className="flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm border cursor-pointer"
						style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
						title="Import rules from JSON"
					>
						<Upload className="w-4 h-4" />
						Import
						<input type="file" accept=".json" onChange={(e) => handleImport(e.target.files?.[0])} className="hidden" />
					</label>
					<button
						onClick={() => {
							setEditingRule(null)
							setShowBuilder(true)
						}}
						className="flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
						style={{ backgroundColor: 'var(--accent)', color: 'var(--accent-contrast)' }}
					>
						<Plus className="w-4 h-4" />
						Create Rule
					</button>
				</div>
			</div>

			{/* Instance Filter */}
			<div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3">
				<select
					value={selectedInstance}
					onChange={(e) => setSelectedInstance(e.target.value === 'all' ? 'all' : parseInt(e.target.value))}
					className="w-full sm:w-auto px-3 py-2 rounded-lg border text-sm"
					style={{
						backgroundColor: 'var(--bg-secondary)',
						borderColor: 'var(--border)',
						color: 'var(--text-primary)',
					}}
				>
					<option value="all">All Instances</option>
					{instances.map((instance) => (
						<option key={instance.id} value={instance.id}>
							{instance.label}
						</option>
					))}
				</select>
				<span className="text-sm" style={{ color: 'var(--text-muted)' }}>
					{filteredRules.length} rule{filteredRules.length !== 1 ? 's' : ''}
				</span>
			</div>

			{/* Error */}
			{error && (
				<div
					className="px-4 py-3 rounded-lg text-sm"
					style={{ backgroundColor: 'color-mix(in srgb, var(--error) 10%, transparent)', color: 'var(--error)' }}
				>
					{error}
				</div>
			)}

			{/* Rules List */}
			{filteredRules.length === 0 ? (
				<div
					className="text-center py-12 rounded-xl border"
					style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border)' }}
				>
					<p className="text-sm mb-2" style={{ color: 'var(--text-muted)' }}>
						No automation rules configured
					</p>
					<p className="text-xs" style={{ color: 'var(--text-muted)' }}>
						Create your first rule to automatically manage torrents
					</p>
				</div>
			) : (
				<div className="space-y-3">
					{filteredRules.map((rule) => {
						const TriggerIcon = triggerIcons[rule.triggerType] || Clock
						const isExpanded = expandedRule === rule.id
						const instance = instances.find((i) => i.id === rule.instanceId)

						return (
							<div
								key={rule.id}
								className="rounded-xl border overflow-hidden transition-all"
								style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border)' }}
							>
								{/* Header Row */}
								<div
									className="flex flex-col sm:flex-row sm:items-center justify-between p-3 sm:p-4 cursor-pointer hover:bg-[var(--bg-tertiary)] transition-colors gap-3 sm:gap-0"
									onClick={() => setExpandedRule(isExpanded ? null : rule.id)}
								>
									<div className="flex items-center gap-3 sm:gap-4 min-w-0">
										<div
											className="w-8 h-8 sm:w-10 sm:h-10 rounded-lg flex items-center justify-center shrink-0"
											style={{ backgroundColor: 'var(--bg-tertiary)' }}
										>
											<TriggerIcon className="w-4 h-4 sm:w-5 sm:h-5" style={{ color: 'var(--accent)' }} />
										</div>
										<div className="min-w-0 flex-1">
											<div className="flex items-center gap-2 flex-wrap">
												<span className="font-medium truncate" style={{ color: 'var(--text-primary)' }}>
													{rule.name}
												</span>
												{rule.enabled ? (
													<span
														className="text-xs px-2 py-0.5 rounded-full shrink-0"
														style={{
															backgroundColor: 'color-mix(in srgb, #a6e3a1 20%, transparent)',
															color: '#a6e3a1',
														}}
													>
														Enabled
													</span>
												) : (
													<span
														className="text-xs px-2 py-0.5 rounded-full shrink-0"
														style={{
															backgroundColor: 'color-mix(in srgb, var(--text-muted) 20%, transparent)',
															color: 'var(--text-muted)',
														}}
													>
														Disabled
													</span>
												)}
											</div>
											<div className="text-xs mt-1 truncate" style={{ color: 'var(--text-muted)' }}>
												{triggerLabels[rule.triggerType] || rule.triggerType} • {instance?.label || 'Unknown'} •{' '}
												{rule.executionCount} runs
												{rule.lastExecuted && ` • Last: ${new Date(rule.lastExecuted * 1000).toLocaleString()}`}
											</div>
										</div>
									</div>
									<div className="flex items-center gap-1 sm:gap-2 shrink-0">
										<button
											onClick={(e) => {
												e.stopPropagation()
												handleToggleEnabled(rule)
											}}
											className="p-1.5 sm:p-2 rounded-lg transition-colors hover:bg-[var(--bg-tertiary)]"
											style={{ color: rule.enabled ? '#a6e3a1' : 'var(--text-muted)' }}
											title={rule.enabled ? 'Disable' : 'Enable'}
										>
											{rule.enabled ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
										</button>
										<button
											onClick={(e) => {
												e.stopPropagation()
												setTestingRule(rule)
											}}
											className="p-1.5 sm:p-2 rounded-lg transition-colors hover:bg-[var(--bg-tertiary)]"
											style={{ color: 'var(--text-muted)' }}
											title="Test Rule"
										>
											<TestTube className="w-4 h-4" />
										</button>
										<button
											onClick={(e) => {
												e.stopPropagation()
												handleRunRule(rule, true)
											}}
											className="p-1.5 sm:p-2 rounded-lg transition-colors hover:bg-[var(--bg-tertiary)]"
											style={{ color: 'var(--accent)' }}
											title="Run Now (Dry Run)"
										>
											<Play className="w-4 h-4" />
										</button>
										<button
											onClick={(e) => {
												e.stopPropagation()
												setViewingLogs(rule)
											}}
											className="p-1.5 sm:p-2 rounded-lg transition-colors hover:bg-[var(--bg-tertiary)]"
											style={{ color: 'var(--text-muted)' }}
											title="View Logs"
										>
											<History className="w-4 h-4" />
										</button>
										<button
											onClick={(e) => {
												e.stopPropagation()
												setEditingRule(rule)
												setShowBuilder(true)
											}}
											className="p-1.5 sm:p-2 rounded-lg transition-colors hover:bg-[var(--bg-tertiary)]"
											style={{ color: 'var(--text-muted)' }}
											title="Edit"
										>
											<Pencil className="w-4 h-4" />
										</button>
										<button
											onClick={(e) => {
												e.stopPropagation()
												setDeleteConfirm(rule)
											}}
											className="p-1.5 sm:p-2 rounded-lg transition-colors hover:bg-[var(--bg-tertiary)]"
											style={{ color: 'var(--error)' }}
											title="Delete"
										>
											<Trash2 className="w-4 h-4" />
										</button>
										{isExpanded ? (
											<ChevronDown className="w-5 h-5" style={{ color: 'var(--text-muted)' }} />
										) : (
											<ChevronRight className="w-5 h-5" style={{ color: 'var(--text-muted)' }} />
										)}
									</div>
								</div>

								{/* Expanded Details */}
								{isExpanded && (
									<div className="px-3 sm:px-4 pb-3 sm:pb-4 border-t" style={{ borderColor: 'var(--border)' }}>
										<div className="mt-3 sm:mt-4 space-y-3">
											<div>
												<div className="text-xs uppercase tracking-wider mb-2" style={{ color: 'var(--text-muted)' }}>
													Conditions (JSON Logic)
												</div>
												<pre
													className="p-3 rounded-lg text-xs overflow-auto max-h-40"
													style={{ backgroundColor: 'var(--bg-tertiary)', color: 'var(--text-primary)' }}
												>
													{JSON.stringify(rule.conditions, null, 2)}
												</pre>
											</div>
											<div>
												<div className="text-xs uppercase tracking-wider mb-2" style={{ color: 'var(--text-muted)' }}>
													Actions ({rule.actions.length})
												</div>
												<div className="space-y-2">
													{rule.actions.map((action, idx) => (
														<div
															key={idx}
															className="flex items-center gap-2 px-2 sm:px-3 py-1.5 sm:py-2 rounded-lg text-xs sm:text-sm"
															style={{ backgroundColor: 'var(--bg-tertiary)' }}
														>
															<span style={{ color: 'var(--accent)' }}>{action.type}</span>
															{action.category && (
																<span style={{ color: 'var(--text-muted)' }}>→ {action.category}</span>
															)}
															{action.tag && <span style={{ color: 'var(--text-muted)' }}>→ {action.tag}</span>}
														</div>
													))}
												</div>
											</div>
										</div>
									</div>
								)}
							</div>
						)
					})}
				</div>
			)}

			{/* Modals */}
			{showBuilder && (
				<AutomationRuleBuilder
					instances={instances}
					rule={editingRule}
					conditionExamples={conditionExamples}
					actionExamples={actionExamples}
					onClose={() => {
						setShowBuilder(false)
						setEditingRule(null)
					}}
					onSave={async () => {
						await loadRules()
						setShowBuilder(false)
						setEditingRule(null)
					}}
				/>
			)}

			{testingRule && (
				<AutomationRuleTester rule={testingRule} instances={instances} onClose={() => setTestingRule(null)} />
			)}

			{viewingLogs && <AutomationLogsViewer rule={viewingLogs} onClose={() => setViewingLogs(null)} />}

			{/* Delete Confirm */}
			{deleteConfirm && (
				<div
					className="fixed inset-0 z-50 flex items-center justify-center p-4"
					style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
				>
					<div
						className="w-full max-w-sm rounded-xl border p-6"
						style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border)' }}
					>
						<h3 className="text-lg font-medium mb-2" style={{ color: 'var(--text-primary)' }}>
							Delete Rule
						</h3>
						<p className="text-sm mb-6" style={{ color: 'var(--text-muted)' }}>
							Are you sure you want to delete{' '}
							<strong style={{ color: 'var(--text-primary)' }}>{deleteConfirm.name}</strong>? This action cannot be
							undone.
						</p>
						<div className="flex gap-3 justify-end">
							<button
								onClick={() => setDeleteConfirm(null)}
								className="px-4 py-2 rounded-lg text-sm border"
								style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)' }}
							>
								Cancel
							</button>
							<button
								onClick={handleDelete}
								className="px-4 py-2 rounded-lg text-sm font-medium"
								style={{ backgroundColor: 'var(--error)', color: 'var(--accent-contrast)' }}
							>
								Delete
							</button>
						</div>
					</div>
				</div>
			)}

			{/* Toast Notifications */}
			<ToastContainer toasts={toasts} onRemove={removeToast} />
		</div>
	)
}
