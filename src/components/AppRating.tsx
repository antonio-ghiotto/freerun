import { useEffect, useState } from "react";
import { Star } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";


const KEY = "freerun:app-rating";

export function AppRating() {
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);

  useEffect(() => {
    try {
      const v = Number(localStorage.getItem(KEY) || "0");
      if (v >= 1 && v <= 5) setRating(v);
    } catch {
      /* ignore */
    }
  }, []);

  const setValue = async (v: number) => {
    setRating(v);
    try {
      localStorage.setItem(KEY, String(v));
    } catch {
      /* ignore */
    }
    toast.success(
      v >= 4 ? "Grazie per il tuo supporto!" : "Grazie per il feedback!",
    );
    try {
      await supabase.from("app_ratings").insert({
        stars: v,
        user_agent:
          typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 300) : null,
      });
    } catch (err) {
      console.warn("rating submit failed", err);
    }
  };


  const active = hover || rating;

  return (
    <div className="border-b border-border p-3">
      <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Ti piace FreeRun?
      </div>
      <div
        className="flex items-center gap-1"
        onMouseLeave={() => setHover(0)}
        role="radiogroup"
        aria-label="Valutazione app"
      >
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={rating === n}
            aria-label={`${n} ${n === 1 ? "stella" : "stelle"}`}
            onMouseEnter={() => setHover(n)}
            onClick={() => setValue(n)}
            className="rounded p-1 transition hover:scale-110"
          >
            <Star
              className={cn(
                "h-6 w-6 transition",
                n <= active
                  ? "fill-yellow-400 text-yellow-500"
                  : "text-muted-foreground",
              )}
            />
          </button>
        ))}
        {rating > 0 && (
          <button
            type="button"
            onClick={() => {
              setRating(0);
              localStorage.removeItem(KEY);
            }}
            className="ml-2 text-[11px] text-muted-foreground underline hover:text-foreground"
          >
            reset
          </button>
        )}
      </div>
    </div>
  );
}
