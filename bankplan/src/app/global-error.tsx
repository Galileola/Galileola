"use client"; // Error pages must run in the browser.

/**
 * Last-resort error page, used only if the main page frame itself fails.
 * It cannot load the language files, so it shows all three languages.
 */
export default function GlobalError({ retry }: { error: unknown; retry: () => void }) {
  return (
    <html lang="et">
      <body style={{ fontFamily: "system-ui, sans-serif", maxWidth: 640, margin: "48px auto", padding: "0 16px", color: "#0f172a" }}>
        <title>Viga / Ошибка / Error</title>
        <h1 style={{ fontSize: 22 }}>Midagi läks valesti. Proovi uuesti.</h1>
        <p>Что-то пошло не так. Попробуйте ещё раз.</p>
        <p>Something went wrong. Please try again.</p>
        <button
          type="button"
          onClick={() => retry()}
          style={{ marginTop: 16, padding: "8px 16px", background: "#1d4ed8", color: "white", border: 0, borderRadius: 6 }}
        >
          Proovi uuesti / Повторить / Try again
        </button>
      </body>
    </html>
  );
}
