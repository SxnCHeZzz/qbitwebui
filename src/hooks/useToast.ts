import { useState, useCallback } from 'react'

export interface Toast {
	id: string
	message: string
	type: 'success' | 'error' | 'info'
	duration?: number
}

export function useToast() {
	const [toasts, setToasts] = useState<Toast[]>([])

	const addToast = useCallback((message: string, type: Toast['type'] = 'info', duration = 3000) => {
		const id = Math.random().toString(36).substring(2, 9)
		const toast: Toast = { id, message, type, duration }
		setToasts((prev) => [...prev, toast])

		setTimeout(() => {
			setToasts((prev) => prev.filter((t) => t.id !== id))
		}, duration)
	}, [])

	const removeToast = useCallback((id: string) => {
		setToasts((prev) => prev.filter((t) => t.id !== id))
	}, [])

	return { toasts, addToast, removeToast }
}
