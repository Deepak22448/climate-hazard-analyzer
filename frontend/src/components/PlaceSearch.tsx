import { Loader2, MapPin } from 'lucide-react'
import { useEffect, useState } from 'react'

import { usePlaces } from '@/api'
import { Input } from '@/components/ui/input'
import type { Place } from '@/types'

const DEBOUNCE_MS = 350

type Props = {
  kind: 'city' | 'state'
  onPick: (place: Place) => void
}

export function PlaceSearch({ kind, onPick }: Props) {
  const [text, setText] = useState('')
  const [debounced, setDebounced] = useState('')
  const [open, setOpen] = useState(false)
  const places = usePlaces(debounced, kind)

  // Wait until typing pauses so every keystroke doesn't hit the API.
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(text.trim()), DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [text])

  function pick(place: Place) {
    onPick(place)
    setText('')
    setOpen(false)
  }

  return (
    <div className="relative">
      <Input
        value={text}
        placeholder={kind === 'city' ? 'Search a city…' : 'Search a state or province…'}
        onChange={(e) => {
          setText(e.target.value)
          setOpen(true)
        }}
        onBlur={() => setTimeout(() => setOpen(false), 150)} // let a click on a result land first
      />
      {places.isFetching && (
        <Loader2 className="absolute top-2 right-2 size-4 animate-spin text-muted-foreground" />
      )}
      {open && debounced.length >= 2 && places.data && (
        <ul className="absolute z-[1000] mt-1 w-full overflow-hidden rounded-lg border bg-popover shadow-md">
          {places.data.length === 0 && <li className="p-2 text-sm text-muted-foreground">No matches</li>}
          {places.data.map((place) => (
            <li key={place.id}>
              <button
                type="button"
                className="flex w-full items-start gap-2 p-2 text-left text-sm hover:bg-accent focus:bg-accent focus:outline-none"
                onClick={() => pick(place)}
              >
                <MapPin className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <span>
                  {place.name}
                  <span className="block text-xs text-muted-foreground">{place.detail}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {places.isError && <p className="mt-1 text-xs text-destructive">{places.error.message}</p>}
    </div>
  )
}
