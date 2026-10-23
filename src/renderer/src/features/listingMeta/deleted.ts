// Listings deleted from "Небезпечна зона" this session: the other sections of
// the same listing stop offering edits of a listing that no longer exists.

import { create } from 'zustand'

interface DeletedListings {
  ids: number[]
  markDeleted: (listingId: number) => void
}

export const useDeletedListings = create<DeletedListings>((set) => ({
  ids: [],
  markDeleted: (listingId) => set((s) => ({ ids: [...s.ids, listingId] }))
}))
