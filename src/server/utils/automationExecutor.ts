import type { Action, ActionResult } from '../../types/automation'
import type { Torrent } from '../../types/qbittorrent'
import { log } from './logger'
import { loginToQbt } from './qbt'
import { fetchWithTls } from './fetch'

// Разрешенные команды для type: 'command'
const ALLOWED_COMMANDS = ['echo', 'curl', 'wget', 'sleep']
const MAX_COMMAND_TIMEOUT = 60000 // 60 секунд

export interface ExecutorContext {
	instanceId: number
	userId: number
	instanceUrl: string
	instanceUsername: string | null
	instancePasswordEncrypted: string | null
	skipAuth: boolean
	torrent: Torrent
	triggeredBy: string
	dryRun?: boolean
}

export interface ExecutorResult {
	success: boolean
	actionResults: ActionResult[]
	durationMs: number
	error?: string
}

/**
 * Выполняет массив действий для торрента
 */
export async function executeActions(actions: Action[], context: ExecutorContext): Promise<ExecutorResult> {
	const startTime = performance.now()
	const results: ActionResult[] = []

	log.info(
		`[Automation Executor] Executing ${actions.length} actions for torrent ${context.torrent.hash} (dryRun=${context.dryRun})`
	)

	// Логинимся в qBittorrent один раз для всех действий
	let cookie: string | null = null
	try {
		const loginResult = await loginToQbt(
			{
				url: context.instanceUrl,
				qbt_username: context.instanceUsername,
				qbt_password_encrypted: context.instancePasswordEncrypted,
				skip_auth: context.skipAuth ? 1 : 0,
			},
			10000 // 10 секунд таймаут
		)

		if (!loginResult.success) {
			throw new Error(`qBittorrent login failed: ${'error' in loginResult ? loginResult.error : 'Unknown'}`)
		}
		cookie = loginResult.cookie
	} catch (error) {
		return {
			success: false,
			actionResults: [],
			durationMs: Math.round(performance.now() - startTime),
			error: error instanceof Error ? error.message : 'Login failed',
		}
	}

	// Выполняем действия последовательно
	for (const action of actions) {
		try {
			const result = await executeSingleAction(action, context, cookie)
			results.push(result)

			if (!result.success) {
				log.warn(`[Automation] Action ${action.type} failed: ${result.message}`)
				// Продолжаем выполнение других действий (можно добавить флаг "stop_on_error")
			}
		} catch (error) {
			const message = error instanceof Error ? error.message : 'Unknown error'
			results.push({
				success: false,
				action,
				message,
			})
			log.error(`[Automation] Action ${action.type} threw error: ${message}`)
		}
	}

	const success = results.every((r) => r.success)

	return {
		success,
		actionResults: results,
		durationMs: Math.round(performance.now() - startTime),
	}
}

/**
 * Выполняет одно действие
 */
async function executeSingleAction(
	action: Action,
	context: ExecutorContext,
	cookie: string | null
): Promise<ActionResult> {
	const { torrent, instanceUrl, dryRun } = context
	const headers: Record<string, string> = cookie ? { Cookie: cookie } : {}
	const dryRunPrefix = dryRun ? '[DRY RUN] ' : ''

	switch (action.type) {
		case 'set_category': {
			if (!action.category) throw new Error('Category required')

			// Нормализуем имя категории для qBittorrent
			const normalizedCategory = action.category
				.toLowerCase()
				.trim()
				.replace(/[^a-z0-9_-]/g, '_')
				.replace(/_+/g, '_')

			console.log(`[DEBUG] ${dryRunPrefix}set_category`, {
				hash: torrent.hash,
				original: action.category,
				normalized: normalizedCategory,
			})
			log.info(`[Automation Executor] ${dryRunPrefix}Setting category "${normalizedCategory}" for ${torrent.hash}`)

			// Сначала создаем категорию, если она не существует
			// qBittorrent требует, чтобы категория была создана перед назначением
			const createCatBody = new URLSearchParams()
			createCatBody.append('category', normalizedCategory)
			createCatBody.append('savePath', '')

			console.log(`[DEBUG] ${dryRunPrefix}Creating category first:`, createCatBody.toString())

			const createRes = await fetchWithTls(`${instanceUrl}/api/v2/torrents/createCategory`, {
				method: 'POST',
				headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' },
				body: createCatBody.toString(),
			})

			console.log(`[DEBUG] ${dryRunPrefix}createCategory response:`, createRes.status, createRes.statusText)
			if (!createRes.ok) {
				const errText = await createRes.text().catch(() => 'Unknown')
				console.log(`[DEBUG] ${dryRunPrefix}createCategory error (might already exist):`, errText)
				// Не выбрасываем ошибку - категория может уже существовать
			}

			// Теперь назначаем категорию торренту
			const body = new URLSearchParams()
			body.append('hashes', torrent.hash)
			body.append('category', normalizedCategory)

			console.log(`[DEBUG] ${dryRunPrefix}Setting category with body:`, body.toString())

			const res = await fetchWithTls(`${instanceUrl}/api/v2/torrents/setCategory`, {
				method: 'POST',
				headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' },
				body: body.toString(),
			})

			console.log(`[DEBUG] ${dryRunPrefix}setCategory response:`, res.status, res.statusText)

			if (!res.ok) {
				const errorText = await res.text().catch(() => 'Unknown error')
				console.error(`[DEBUG] ${dryRunPrefix}setCategory failed:`, errorText)
				log.error(`[Automation Executor] setCategory failed: HTTP ${res.status}, ${errorText}`)
				throw new Error(`HTTP ${res.status}: ${errorText}`)
			}
			log.info(`[Automation Executor] ${dryRunPrefix}Category set successfully`)
			return { success: true, action, message: `${dryRunPrefix}Category set to "${normalizedCategory}"` }
		}

		case 'add_tag': {
			if (!action.tag) throw new Error('Tag required')

			console.log(`[DEBUG] ${dryRunPrefix}add_tag`, { hash: torrent.hash, tag: action.tag, instanceUrl })
			log.info(`[Automation Executor] ${dryRunPrefix}Adding tag "${action.tag}" to torrent ${torrent.hash}`)

			// Выполняем реальный запрос даже в dryRun для тестирования
			const body = new URLSearchParams()
			body.append('hashes', torrent.hash)
			body.append('tags', action.tag)

			console.log(`[DEBUG] ${dryRunPrefix}Request body:`, body.toString())

			const res = await fetchWithTls(`${instanceUrl}/api/v2/torrents/addTags`, {
				method: 'POST',
				headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' },
				body: body.toString(),
			})

			console.log(`[DEBUG] ${dryRunPrefix}Response status:`, res.status, res.statusText)

			if (!res.ok) {
				const errorText = await res.text().catch(() => 'Unknown error')
				console.error(`[DEBUG] ${dryRunPrefix}addTags failed:`, errorText)
				log.error(`[Automation Executor] addTags failed: HTTP ${res.status}, ${errorText}`)
				throw new Error(`HTTP ${res.status}: ${errorText}`)
			}
			log.info(`[Automation Executor] ${dryRunPrefix}Tag "${action.tag}" added successfully`)
			return { success: true, action, message: `${dryRunPrefix}Tag "${action.tag}" added` }
		}

		case 'remove_tag': {
			if (!action.tag) throw new Error('Tag required')

			console.log(`[DEBUG] ${dryRunPrefix}remove_tag`, { hash: torrent.hash, tag: action.tag })
			log.info(`[Automation Executor] ${dryRunPrefix}Removing tag "${action.tag}" from torrent ${torrent.hash}`)

			const res = await fetchWithTls(`${instanceUrl}/api/v2/torrents/removeTags`, {
				method: 'POST',
				headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' },
				body: new URLSearchParams({
					hashes: torrent.hash,
					tags: action.tag,
				}),
			})

			if (!res.ok) {
				const errorText = await res.text().catch(() => 'Unknown error')
				console.error(`[DEBUG] ${dryRunPrefix}removeTags failed:`, errorText)
				log.error(`[Automation Executor] removeTags failed: HTTP ${res.status}, ${errorText}`)
				throw new Error(`HTTP ${res.status}: ${errorText}`)
			}
			log.info(`[Automation Executor] ${dryRunPrefix}Tag "${action.tag}" removed successfully`)
			return { success: true, action, message: `${dryRunPrefix}Tag "${action.tag}" removed` }
		}

		case 'set_upload_limit': {
			if (action.limit === undefined) throw new Error('Limit required')

			const limitText = action.limit === 0 ? 'unlimited' : `${action.limit} bytes/s`
			console.log(`[DEBUG] ${dryRunPrefix}set_upload_limit`, { hash: torrent.hash, limit: action.limit })
			log.info(`[Automation Executor] ${dryRunPrefix}Setting upload limit to ${limitText} for ${torrent.hash}`)

			const res = await fetchWithTls(`${instanceUrl}/api/v2/torrents/setUploadLimit`, {
				method: 'POST',
				headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' },
				body: new URLSearchParams({
					hashes: torrent.hash,
					limit: String(action.limit),
				}),
			})

			if (!res.ok) {
				const errorText = await res.text().catch(() => 'Unknown error')
				console.error(`[DEBUG] ${dryRunPrefix}setUploadLimit failed:`, errorText)
				log.error(`[Automation Executor] setUploadLimit failed: HTTP ${res.status}, ${errorText}`)
				throw new Error(`HTTP ${res.status}: ${errorText}`)
			}
			log.info(`[Automation Executor] ${dryRunPrefix}Upload limit set to ${limitText}`)
			return { success: true, action, message: `${dryRunPrefix}Upload limit set to ${limitText}` }
		}

		case 'set_download_limit': {
			if (action.limit === undefined) throw new Error('Limit required')

			const limitText = action.limit === 0 ? 'unlimited' : `${action.limit} bytes/s`
			console.log(`[DEBUG] ${dryRunPrefix}set_download_limit`, { hash: torrent.hash, limit: action.limit })
			log.info(`[Automation Executor] ${dryRunPrefix}Setting download limit to ${limitText} for ${torrent.hash}`)

			const res = await fetchWithTls(`${instanceUrl}/api/v2/torrents/setDownloadLimit`, {
				method: 'POST',
				headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' },
				body: new URLSearchParams({
					hashes: torrent.hash,
					limit: String(action.limit),
				}),
			})

			if (!res.ok) {
				const errorText = await res.text().catch(() => 'Unknown error')
				console.error(`[DEBUG] ${dryRunPrefix}setDownloadLimit failed:`, errorText)
				log.error(`[Automation Executor] setDownloadLimit failed: HTTP ${res.status}, ${errorText}`)
				throw new Error(`HTTP ${res.status}: ${errorText}`)
			}
			log.info(`[Automation Executor] ${dryRunPrefix}Download limit set to ${limitText}`)
			return { success: true, action, message: `${dryRunPrefix}Download limit set to ${limitText}` }
		}

		case 'pause': {
			console.log(`[DEBUG] ${dryRunPrefix}pause`, { hash: torrent.hash })
			log.info(`[Automation Executor] ${dryRunPrefix}Pausing torrent ${torrent.hash}`)

			const res = await fetchWithTls(`${instanceUrl}/api/v2/torrents/pause`, {
				method: 'POST',
				headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' },
				body: new URLSearchParams({ hashes: torrent.hash }),
			})

			if (!res.ok) {
				const errorText = await res.text().catch(() => 'Unknown error')
				console.error(`[DEBUG] ${dryRunPrefix}pause failed:`, errorText)
				log.error(`[Automation Executor] pause failed: HTTP ${res.status}, ${errorText}`)
				throw new Error(`HTTP ${res.status}: ${errorText}`)
			}
			log.info(`[Automation Executor] ${dryRunPrefix}Torrent paused`)
			return { success: true, action, message: `${dryRunPrefix}Torrent paused` }
		}

		case 'resume': {
			console.log(`[DEBUG] ${dryRunPrefix}resume`, { hash: torrent.hash })
			log.info(`[Automation Executor] ${dryRunPrefix}Resuming torrent ${torrent.hash}`)

			const res = await fetchWithTls(`${instanceUrl}/api/v2/torrents/resume`, {
				method: 'POST',
				headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' },
				body: new URLSearchParams({ hashes: torrent.hash }),
			})

			if (!res.ok) {
				const errorText = await res.text().catch(() => 'Unknown error')
				console.error(`[DEBUG] ${dryRunPrefix}resume failed:`, errorText)
				log.error(`[Automation Executor] resume failed: HTTP ${res.status}, ${errorText}`)
				throw new Error(`HTTP ${res.status}: ${errorText}`)
			}
			log.info(`[Automation Executor] ${dryRunPrefix}Torrent resumed`)
			return { success: true, action, message: `${dryRunPrefix}Torrent resumed` }
		}

		case 'delete': {
			const deleteFiles = action.deleteFiles ?? false

			console.log(`[DEBUG] ${dryRunPrefix}delete`, { hash: torrent.hash, deleteFiles })
			log.info(`[Automation Executor] ${dryRunPrefix}Deleting torrent ${torrent.hash}, deleteFiles=${deleteFiles}`)

			const res = await fetchWithTls(`${instanceUrl}/api/v2/torrents/delete`, {
				method: 'POST',
				headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' },
				body: new URLSearchParams({
					hashes: torrent.hash,
					deleteFiles: String(deleteFiles),
				}),
			})

			if (!res.ok) {
				const errorText = await res.text().catch(() => 'Unknown error')
				console.error(`[DEBUG] ${dryRunPrefix}delete failed:`, errorText)
				log.error(`[Automation Executor] delete failed: HTTP ${res.status}, ${errorText}`)
				throw new Error(`HTTP ${res.status}: ${errorText}`)
			}
			log.info(`[Automation Executor] ${dryRunPrefix}Torrent deleted successfully`)
			const msg = deleteFiles
				? `${dryRunPrefix}Torrent and files deleted`
				: `${dryRunPrefix}Torrent deleted (kept files)`
			return { success: true, action, message: msg }
		}

		case 'move': {
			if (!action.destination) throw new Error('Destination required')

			console.log(`[DEBUG] ${dryRunPrefix}move`, { hash: torrent.hash, destination: action.destination })
			log.info(`[Automation Executor] ${dryRunPrefix}Moving torrent ${torrent.hash} to "${action.destination}"`)

			const res = await fetchWithTls(`${instanceUrl}/api/v2/torrents/setLocation`, {
				method: 'POST',
				headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' },
				body: new URLSearchParams({
					hashes: torrent.hash,
					location: action.destination,
				}),
			})

			if (!res.ok) {
				const errorText = await res.text().catch(() => 'Unknown error')
				console.error(`[DEBUG] ${dryRunPrefix}setLocation failed:`, errorText)
				log.error(`[Automation Executor] setLocation failed: HTTP ${res.status}, ${errorText}`)
				throw new Error(`HTTP ${res.status}: ${errorText}`)
			}
			log.info(`[Automation Executor] ${dryRunPrefix}Torrent moved to "${action.destination}"`)
			return { success: true, action, message: `${dryRunPrefix}Moved to "${action.destination}"` }
		}

		case 'set_priority': {
			if (action.priority === undefined) throw new Error('Priority required')

			console.log(`[DEBUG] ${dryRunPrefix}set_priority`, { hash: torrent.hash, priority: action.priority })
			log.info(`[Automation Executor] ${dryRunPrefix}Setting priority ${action.priority} for torrent ${torrent.hash}`)

			// qBittorrent API: priority 0-7 (topPrio, increasePrio, decreasePrio, bottomPrio)
			const res = await fetchWithTls(`${instanceUrl}/api/v2/torrents/topPrio`, {
				method: 'POST',
				headers: { ...headers, 'Content-Type': 'application/x-www-form-urlencoded' },
				body: new URLSearchParams({ hashes: torrent.hash }),
			})

			if (!res.ok) {
				const errorText = await res.text().catch(() => 'Unknown error')
				console.error(`[DEBUG] ${dryRunPrefix}topPrio failed:`, errorText)
				log.error(`[Automation Executor] topPrio failed: HTTP ${res.status}, ${errorText}`)
				throw new Error(`HTTP ${res.status}: ${errorText}`)
			}
			log.info(`[Automation Executor] ${dryRunPrefix}Priority set to ${action.priority}`)
			return { success: true, action, message: `${dryRunPrefix}Priority set to ${action.priority}` }
		}

		case 'webhook': {
			if (!action.url) throw new Error('URL required')

			const method = action.method ?? 'POST'
			console.log(`[DEBUG] ${dryRunPrefix}webhook`, { hash: torrent.hash, url: action.url, method })
			log.info(`[Automation Executor] ${dryRunPrefix}Calling webhook ${action.url} for torrent ${torrent.hash}`)

			const webhookHeaders: Record<string, string> = {
				'Content-Type': 'application/json',
				...action.headers,
			}

			// Подставляем переменные в body
			let body = action.body
			if (body) {
				body = body
					.replace(/\{\{hash\}\}/g, torrent.hash)
					.replace(/\{\{name\}\}/g, torrent.name)
					.replace(/\{\{category\}\}/g, torrent.category)
					.replace(/\{\{state\}\}/g, torrent.state)
			}

			const res = await fetchWithTls(action.url, {
				method,
				headers: webhookHeaders,
				body: body ?? undefined,
				signal: AbortSignal.timeout(30000),
			})

			if (!res.ok) {
				console.error(`[DEBUG] ${dryRunPrefix}webhook failed:`, res.status)
				log.error(`[Automation Executor] webhook failed: HTTP ${res.status}`)
				throw new Error(`HTTP ${res.status}`)
			}
			log.info(`[Automation Executor] ${dryRunPrefix}Webhook called: ${res.status}`)
			return { success: true, action, message: `${dryRunPrefix}Webhook called: ${res.status}` }
		}

		case 'command': {
			if (!action.cmd) throw new Error('Command required')

			console.log(`[DEBUG] ${dryRunPrefix}command`, { hash: torrent.hash, cmd: action.cmd, args: action.args })
			log.info(`[Automation Executor] ${dryRunPrefix}Executing command "${action.cmd}" for torrent ${torrent.hash}`)

			// Проверка разрешенных команд
			const baseCmd = action.cmd.split(' ')[0]
			if (!ALLOWED_COMMANDS.includes(baseCmd)) {
				throw new Error(`Command "${baseCmd}" not allowed. Allowed: ${ALLOWED_COMMANDS.join(', ')}`)
			}

			const timeout = Math.min(action.timeout ?? 30000, MAX_COMMAND_TIMEOUT)

			try {
				const proc = Bun.spawn([action.cmd, ...(action.args ?? [])], {
					timeout,
					stdout: 'pipe',
					stderr: 'pipe',
				})

				const exitCode = await proc.exited

				if (exitCode !== 0) {
					const stderr = await new Response(proc.stderr).text()
					console.error(`[DEBUG] ${dryRunPrefix}command failed:`, exitCode, stderr.slice(0, 200))
					throw new Error(`Exit code ${exitCode}: ${stderr.slice(0, 200)}`)
				}

				log.info(`[Automation Executor] ${dryRunPrefix}Command executed (exit ${exitCode})`)
				return { success: true, action, message: `${dryRunPrefix}Command executed (exit ${exitCode})` }
			} catch (error) {
				console.error(`[DEBUG] ${dryRunPrefix}command error:`, error)
				throw new Error(`Command failed: ${error instanceof Error ? error.message : 'Unknown'}`)
			}
		}

		default:
			throw new Error(`Unknown action type: ${(action as Action).type}`)
	}
}

/**
 * Проверяет валидность действий
 */
export function validateActions(actions: Action[]): { valid: boolean; errors: string[] } {
	const errors: string[] = []

	for (let i = 0; i < actions.length; i++) {
		const action = actions[i]

		if (!action.type) {
			errors.push(`Action ${i + 1}: Missing type`)
			continue
		}

		switch (action.type) {
			case 'set_category':
				if (!action.category) errors.push(`Action ${i + 1} (set_category): Missing category`)
				break
			case 'add_tag':
			case 'remove_tag':
				if (!action.tag) errors.push(`Action ${i + 1} (${action.type}): Missing tag`)
				break
			case 'set_upload_limit':
			case 'set_download_limit':
				if (action.limit === undefined || action.limit < 0)
					errors.push(`Action ${i + 1} (${action.type}): Invalid limit`)
				break
			case 'move':
				if (!action.destination) errors.push(`Action ${i + 1} (move): Missing destination`)
				break
			case 'set_priority':
				if (action.priority === undefined || action.priority < 0 || action.priority > 7)
					errors.push(`Action ${i + 1} (set_priority): Priority must be 0-7`)
				break
			case 'webhook':
				if (!action.url) errors.push(`Action ${i + 1} (webhook): Missing URL`)
				try {
					new URL(action.url || '')
				} catch {
					errors.push(`Action ${i + 1} (webhook): Invalid URL`)
				}
				break
			case 'command':
				if (!action.cmd) errors.push(`Action ${i + 1} (command): Missing command`)
				else {
					const baseCmd = action.cmd.split(' ')[0]
					if (!ALLOWED_COMMANDS.includes(baseCmd)) {
						errors.push(`Action ${i + 1} (command): "${baseCmd}" not in allowed list`)
					}
				}
				break
			case 'pause':
			case 'resume':
			case 'delete':
				// No additional validation needed
				break
			default:
				errors.push(`Action ${i + 1}: Unknown type "${action.type}"`)
		}
	}

	return { valid: errors.length === 0, errors }
}

/**
 * Получает примеры действий для UI
 */
export function getExampleActions(): Array<{ name: string; action: Action }> {
	return [
		{
			name: 'Изменить категорию',
			action: { type: 'set_category', category: 'Completed' },
		},
		{
			name: 'Добавить тег',
			action: { type: 'add_tag', tag: 'auto-processed' },
		},
		{
			name: 'Удалить тег',
			action: { type: 'remove_tag', tag: 'auto-processed' },
		},
		{
			name: 'Ограничить аплоад (100KB/s)',
			action: { type: 'set_upload_limit', limit: 102400 },
		},
		{
			name: 'Снять ограничения скорости',
			action: { type: 'set_upload_limit', limit: 0 },
		},
		{
			name: 'Приостановить торрент',
			action: { type: 'pause' },
		},
		{
			name: 'Возобновить торрент',
			action: { type: 'resume' },
		},
		{
			name: 'Удалить торрент (сохранить файлы)',
			action: { type: 'delete', deleteFiles: false },
		},
		{
			name: 'Удалить торрент и файлы',
			action: { type: 'delete', deleteFiles: true },
		},
		{
			name: 'Переместить в другую папку',
			action: { type: 'move', destination: '/mnt/media/completed' },
		},
		{
			name: 'Высокий приоритет',
			action: { type: 'set_priority', priority: 7 },
		},
		{
			name: 'Webhook уведомление',
			action: {
				type: 'webhook',
				url: 'https://example.com/webhook',
				method: 'POST',
				body: '{"torrent":"{{name}}","state":"{{state}}"}',
			},
		},
	]
}
