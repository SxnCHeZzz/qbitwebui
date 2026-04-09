/* eslint-disable react-refresh/only-export-components */

import { useState, type ReactNode, createContext, useContext, useMemo } from 'react'

interface PaginationValue {
    page: number
    perPage: number
    totalItems: number
    totalPages: number
    setPage: (page: number) => void
    setPerPage: (perPage: number) => void
    setTotalItems: (total: number) => void
}

const PaginationContext = createContext<PaginationValue | null>(null)

interface Props {
    children: ReactNode
}

export function PaginationProvider({ children }: Props) {
    const [page, setPage] = useState(1)
    const [perPage, setPerPage] = useState(() => {
        const stored = localStorage.getItem('torrentsPerPage')
        return stored ? parseInt(stored, 10) : 50
    })
    const [totalItems, setTotalItems] = useState(0)

    const totalPages = Math.max(1, Math.ceil(totalItems / perPage))

    const handleSetPerPage = (value: number) => {
        setPerPage(value)
        setPage(1)
        localStorage.setItem('torrentsPerPage', value.toString())
    }

    const value = useMemo(() => ({
        page,
        perPage,
        totalItems,
        totalPages,
        setPage,
        setPerPage: handleSetPerPage,
        setTotalItems,
    }), [page, perPage, totalItems, totalPages])

    return (
        <PaginationContext.Provider value={value}>
            {children}
        </PaginationContext.Provider>
    )
}

// Хук для использования в компонентах
export const usePagination = () => {
    const context = useContext(PaginationContext)
    if (!context) {
        throw new Error('usePagination must be used within a PaginationProvider')
    }
    return context
}

export { PaginationContext }