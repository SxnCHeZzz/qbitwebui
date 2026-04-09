import { apply } from 'json-logic-js'
import type { TorrentContext } from '../../types/automation'
import type { Torrent } from '../../types/qbittorrent'
import type { AutomationRule } from '../db'
import { parseRuleConditions } from '../db/automation'

export interface EvaluatorResult {
	matched: boolean
	condition: unknown
	context: Record<string, unknown>
	durationMs: number
	error?: string
}

/**
 * Преобразует Torrent в контекст для json-logic
 * Все поля доступны через { "var": "torrent.field" }
 */
export function buildTorrentContext(torrent: Torrent): TorrentContext {
	// Парсим теги из строки в массив
	const tags = torrent.tags
		.split(',')
		.map((t) => t.trim())
		.filter(Boolean)

	return {
		hash: torrent.hash,
		name: torrent.name,
		size: torrent.size,
		progress: torrent.progress,
		dlspeed: torrent.dlspeed,
		upspeed: torrent.upspeed,
		priority: torrent.priority,
		num_seeds: torrent.num_seeds,
		num_leechs: torrent.num_leechs,
		ratio: torrent.ratio,
		state: torrent.state,
		category: torrent.category || '',
		tags,
		added_on: torrent.added_on,
		completion_on: torrent.completion_on,
		last_activity: torrent.last_activity,
		seeding_time: torrent.seeding_time,
		tracker: torrent.tracker || '',
		uploaded: torrent.uploaded,
		downloaded: torrent.downloaded,
		save_path: torrent.save_path,
	}
}

/**
 * Вычисляет производные поля для условий
 */
function computeDerivedFields(context: TorrentContext): Record<string, unknown> {
	const now = Math.floor(Date.now() / 1000)

	return {
		torrent: {
			...context,
			// Производные поля для удобства
			isCompleted: context.progress >= 1,
			isSeeding: ['uploading', 'stalledUP', 'queuedUP', 'forcedUP'].includes(context.state),
			isDownloading: ['downloading', 'metaDL', 'stalledDL', 'queuedDL', 'forcedDL'].includes(context.state),
			isStopped: ['stoppedUP', 'stoppedDL', 'pausedUP', 'pausedDL'].includes(context.state),
			isError: context.state === 'error' || context.state === 'missingFiles',
			// Время с момента добавления (в часах)
			hoursSinceAdded: context.added_on ? (now - context.added_on) / 3600 : 0,
			// Время с момента завершения (в часах)
			hoursSinceCompleted: context.completion_on ? (now - context.completion_on) / 3600 : 0,
			// Время сидирования в часах
			seedingHours: context.seeding_time / 3600,
			// Размер в GB
			sizeGB: context.size / (1024 * 1024 * 1024),
			// Скорость в KB/s
			upspeedKB: context.upspeed / 1024,
			dlspeedKB: context.dlspeed / 1024,
		},
	}
}

/**
 * Оценивает условия правила для торрента
 */
export function evaluateRule(rule: AutomationRule, torrent: Torrent): EvaluatorResult {
	const startTime = performance.now()

	try {
		const conditions = parseRuleConditions(rule)

		// Если условия пустые — считаем что правило совпало
		if (!conditions || Object.keys(conditions).length === 0) {
			return {
				matched: true,
				condition: conditions,
				context: {},
				durationMs: Math.round(performance.now() - startTime),
			}
		}

		// Строим контекст
		const context = buildTorrentContext(torrent)
		const fullContext = computeDerivedFields(context)

		// Применяем json-logic
		const result = apply(conditions, fullContext)

		// json-logic возвращает truthy/falsy значение
		const matched = Boolean(result)

		return {
			matched,
			condition: conditions,
			context: fullContext,
			durationMs: Math.round(performance.now() - startTime),
		}
	} catch (error) {
		return {
			matched: false,
			condition: parseRuleConditions(rule),
			context: {},
			durationMs: Math.round(performance.now() - startTime),
			error: error instanceof Error ? error.message : 'Unknown evaluation error',
		}
	}
}

/**
 * Тестирует правило без сохранения (для UI)
 */
export function testConditions(conditions: unknown, torrent: Torrent): { matched: boolean; error?: string } {
	try {
		if (!conditions || Object.keys(conditions).length === 0) {
			return { matched: true }
		}

		const context = buildTorrentContext(torrent)
		const fullContext = computeDerivedFields(context)

		const result = apply(conditions, fullContext)
		return { matched: Boolean(result) }
	} catch (error) {
		return {
			matched: false,
			error: error instanceof Error ? error.message : 'Evaluation error',
		}
	}
}

/**
 * Валидация условий (проверяет синтаксис json-logic)
 */
export function validateConditions(conditions: unknown): { valid: boolean; error?: string } {
	try {
		if (!conditions || typeof conditions !== 'object') {
			return { valid: true } // Пустые условия валидны
		}

		// Тестируем на пустом объекте — если не крэшится, синтаксис ок
		apply(conditions, { torrent: {} })
		return { valid: true }
	} catch (error) {
		return {
			valid: false,
			error: error instanceof Error ? error.message : 'Invalid condition syntax',
		}
	}
}

/**
 * Получает примеры условий для UI
 */
export function getExampleConditions(): Array<{ name: string; condition: unknown }> {
	return [
		{
			name: 'Завершенный торрент',
			condition: { '==': [{ var: 'torrent.isCompleted' }, true] },
		},
		{
			name: 'Ratio больше 1.5',
			condition: { '>': [{ var: 'torrent.ratio' }, 1.5] },
		},
		{
			name: 'Сидирование более 7 дней и ratio > 1',
			condition: {
				and: [{ '>': [{ var: 'torrent.seedingHours' }, 168] }, { '>=': [{ var: 'torrent.ratio' }, 1] }],
			},
		},
		{
			name: 'Категория "Movies" и завершен',
			condition: {
				and: [{ '==': [{ var: 'torrent.category' }, 'Movies'] }, { '==': [{ var: 'torrent.isCompleted' }, true] }],
			},
		},
		{
			name: 'Есть тег "keep"',
			condition: { in: ['keep', { var: 'torrent.tags' }] },
		},
		{
			name: 'Ошибка или отсутствуют файлы',
			condition: {
				or: [{ '==': [{ var: 'torrent.state' }, 'error'] }, { '==': [{ var: 'torrent.state' }, 'missingFiles'] }],
			},
		},
		{
			name: 'Размер больше 10GB и скорость аплоада 0',
			condition: {
				and: [{ '>': [{ var: 'torrent.sizeGB' }, 10] }, { '==': [{ var: 'torrent.upspeed' }, 0] }],
			},
		},
	]
}
