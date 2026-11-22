"use client";

import { useEffect, useState } from "react";

// State that survives a reload in this browser. It starts from `initial` so the server render matches.
export function useStoredState<T>(key: string, initial: T) {
    const [value, setValue] = useState(initial);

    useEffect(() => {
        const stored = localStorage.getItem(key);
        if (stored !== null) {
            setValue(JSON.parse(stored) as T);
        }
    }, [key]);

    function update(next: T) {
        setValue(next);
        localStorage.setItem(key, JSON.stringify(next));
    }

    return [value, update] as const;
}
