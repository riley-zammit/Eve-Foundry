// Shown wherever a model is mid-turn.
export function Spinner({ className = "h-3 w-3 text-amber-300" }: { className?: string }) {
    return (
        <svg viewBox="0 0 16 16" fill="none" aria-label="Running" className={`animate-spin ${className}`}>
            <circle cx="8" cy="8" r="6" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2" />
            <path d="M14 8a6 6 0 0 0-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </svg>
    );
}
