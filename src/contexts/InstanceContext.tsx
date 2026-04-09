/* eslint-disable react-refresh/only-export-components */

import { useMemo, type ReactNode, createContext, useContext } from 'react'
import type { Instance } from '../api/instances'

// Создаём контекст прямо здесь
const InstanceContext = createContext<{ instance: Instance } | null>(null)

interface Props {
    instance: Instance
    children: ReactNode
}

export function InstanceProvider({ instance, children }: Props) {
    const value = useMemo(() => ({ instance }), [instance])
    return (
        <InstanceContext.Provider value={value}>
            {children}
        </InstanceContext.Provider>
    )
}

// Хук для удобного использования
export const useInstance = () => {
    const context = useContext(InstanceContext)
    if (!context) {
        throw new Error('useInstance must be used within an InstanceProvider')
    }
    return context
}

export { InstanceContext }