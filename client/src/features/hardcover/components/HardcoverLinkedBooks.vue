<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { ChevronDown, ChevronUp, CheckCircle2, AlertCircle, HelpCircle, Loader2, RefreshCw, Link2 } from 'lucide-vue-next'
import { toast } from 'vue-sonner'
import type { HardcoverEdition, HardcoverLinkedBook } from '@bookorbit/types'
import { fetchHardcoverEditions, fetchHardcoverLinkedBooks, linkHardcoverBook, rematchHardcoverBook, setHardcoverEdition } from '../api/hardcover.api'

const books = ref<HardcoverLinkedBook[]>([])
const loading = ref(true)
const expandedBookId = ref<number | null>(null)
const linkInputs = reactive<Record<number, string>>({})
const linking = reactive<Record<number, boolean>>({})
const rematching = reactive<Record<number, boolean>>({})
const editionsByBookId = reactive<Record<number, HardcoverEdition[]>>({})
const loadingEditions = reactive<Record<number, boolean>>({})
const settingEdition = reactive<Record<number, boolean>>({})

onMounted(async () => {
  await loadBooks()
})

async function loadBooks(): Promise<void> {
  loading.value = true
  try {
    books.value = await fetchHardcoverLinkedBooks()
  } finally {
    loading.value = false
  }
}

function toggleExpanded(bookId: number) {
  expandedBookId.value = expandedBookId.value === bookId ? null : bookId
}

function statusLabel(book: HardcoverLinkedBook): string {
  if (book.matchError) return `Error: ${book.matchError}`
  if (book.hardcoverBookId) return `Linked${book.matchMethod ? ` (${book.matchMethod})` : ''}`
  return 'Not linked yet'
}

function editionLabel(edition: HardcoverEdition): string {
  const parts = [edition.format]
  if (edition.pages) parts.push(`${edition.pages} pages`)
  if (edition.audioSeconds) parts.push(`${Math.round(edition.audioSeconds / 3600)}h`)
  if (edition.year) parts.push(String(edition.year))
  return parts.join(' · ')
}

async function handleLink(book: HardcoverLinkedBook) {
  const input = (linkInputs[book.bookId] ?? '').trim()
  if (!input) {
    toast.error('Paste a Hardcover URL, id, or slug first')
    return
  }
  linking[book.bookId] = true
  try {
    const result = await linkHardcoverBook(book.bookId, input)
    if (result.success) {
      toast.success(`Linked: ${result.title || result.hardcoverBookId}`)
      linkInputs[book.bookId] = ''
      delete editionsByBookId[book.bookId]
      await loadBooks()
    } else {
      toast.error('Could not find that Hardcover book')
    }
  } catch {
    toast.error('Failed to link Hardcover book')
  } finally {
    linking[book.bookId] = false
  }
}

async function handleRematch(book: HardcoverLinkedBook) {
  rematching[book.bookId] = true
  try {
    const { result } = await rematchHardcoverBook(book.bookId)
    if (result === 'synced') toast.success('Re-matched and synced with Hardcover')
    else if (result === 'failed') toast.error('Hardcover re-match failed — check the server logs')
    else toast.info('Hardcover sync is not connected for your account')
    delete editionsByBookId[book.bookId]
    await loadBooks()
  } catch {
    toast.error('Failed to re-match with Hardcover')
  } finally {
    rematching[book.bookId] = false
  }
}

async function loadEditions(book: HardcoverLinkedBook) {
  if (editionsByBookId[book.bookId]) return
  loadingEditions[book.bookId] = true
  try {
    editionsByBookId[book.bookId] = await fetchHardcoverEditions(book.bookId)
  } finally {
    loadingEditions[book.bookId] = false
  }
}

async function handleSetEdition(book: HardcoverLinkedBook, edition: HardcoverEdition) {
  settingEdition[book.bookId] = true
  try {
    const { success } = await setHardcoverEdition(book.bookId, edition.id)
    if (success) {
      toast.success(`Switched to ${edition.format}`)
      delete editionsByBookId[book.bookId]
      await loadBooks()
    } else {
      toast.error('Failed to switch edition')
    }
  } catch {
    toast.error('Failed to switch edition')
  } finally {
    settingEdition[book.bookId] = false
  }
}
</script>

<template>
  <div class="border border-border rounded-lg bg-card px-4 py-4 md:px-5 md:py-5 shadow-xs space-y-4">
    <div>
      <p class="font-medium text-sm">Linked books</p>
      <p class="text-xs text-muted-foreground mt-0.5">
        Shows books you're currently reading. Hardcover's book data is community-maintained, so matching can occasionally pick the wrong book or
        edition. Fix a book here by pasting its correct Hardcover URL, id, or slug, or pick a different edition (physical, ebook, audiobook) once it's
        linked.
      </p>
    </div>

    <div v-if="loading" class="flex items-center gap-2 text-xs text-muted-foreground py-4">
      <Loader2 class="size-3.5 animate-spin" />
      Loading books...
    </div>

    <div v-else-if="books.length === 0" class="text-xs text-muted-foreground py-2">No books currently being read.</div>

    <div v-else class="divide-y divide-border/60">
      <div v-for="book in books" :key="book.bookId" class="py-2.5">
        <button type="button" class="flex w-full items-center justify-between gap-2 text-left" @click="toggleExpanded(book.bookId)">
          <div class="min-w-0">
            <p class="text-sm truncate">{{ book.title ?? 'Untitled' }}</p>
            <p class="text-xs text-muted-foreground truncate">{{ book.authorName ?? 'Unknown author' }}</p>
          </div>
          <div class="flex items-center gap-2 shrink-0">
            <span
              class="flex items-center gap-1 text-xs"
              :class="book.matchError ? 'text-destructive' : book.hardcoverBookId ? 'text-green-600' : 'text-muted-foreground'"
            >
              <AlertCircle v-if="book.matchError" class="size-3.5" />
              <CheckCircle2 v-else-if="book.hardcoverBookId" class="size-3.5" />
              <HelpCircle v-else class="size-3.5" />
              {{ statusLabel(book) }}
            </span>
            <ChevronUp v-if="expandedBookId === book.bookId" class="size-3.5 text-muted-foreground" />
            <ChevronDown v-else class="size-3.5 text-muted-foreground" />
          </div>
        </button>

        <div v-if="expandedBookId === book.bookId" class="mt-3 space-y-3 pl-1">
          <div class="flex gap-2">
            <input
              v-model="linkInputs[book.bookId]"
              type="text"
              placeholder="Paste Hardcover URL, id, or slug"
              class="flex-1 rounded-md border border-border bg-background px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-primary/50"
            />
            <button
              type="button"
              :disabled="linking[book.bookId]"
              class="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              @click="handleLink(book)"
            >
              <Loader2 v-if="linking[book.bookId]" class="size-3 animate-spin" />
              <Link2 v-else class="size-3" />
              Link
            </button>
          </div>

          <button
            type="button"
            :disabled="rematching[book.bookId]"
            class="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md border border-border bg-muted text-muted-foreground hover:bg-muted/80 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            @click="handleRematch(book)"
          >
            <Loader2 v-if="rematching[book.bookId]" class="size-3 animate-spin" />
            <RefreshCw v-else class="size-3" />
            Try auto-match
          </button>

          <div v-if="book.hardcoverBookId">
            <button
              v-if="!editionsByBookId[book.bookId]"
              type="button"
              :disabled="loadingEditions[book.bookId]"
              class="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md border border-border bg-muted text-muted-foreground hover:bg-muted/80 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              @click="loadEditions(book)"
            >
              <Loader2 v-if="loadingEditions[book.bookId]" class="size-3 animate-spin" />
              View editions
            </button>

            <div v-else class="space-y-1.5">
              <p v-if="editionsByBookId[book.bookId]!.length === 0" class="text-xs text-muted-foreground">No editions found.</p>
              <div
                v-for="edition in editionsByBookId[book.bookId]"
                :key="edition.id"
                class="flex items-center justify-between gap-2 rounded-md border border-border/70 bg-muted/40 px-2.5 py-1.5"
              >
                <span class="text-xs">{{ editionLabel(edition) }}</span>
                <button
                  type="button"
                  :disabled="settingEdition[book.bookId] || edition.id === book.hardcoverEditionId"
                  class="px-2 py-1 text-xs rounded-md border border-border bg-background hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  @click="handleSetEdition(book, edition)"
                >
                  {{ edition.id === book.hardcoverEditionId ? 'Current' : 'Use this' }}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
