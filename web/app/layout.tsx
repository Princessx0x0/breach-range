import type { Metadata, Viewport } from "next";

// Self-hosted variable faces (Fontsource, OFL-1.1): no visitor request to Google Fonts.
// Newsreader for display, Atkinson Hyperlegible Next for text, readable at projector distance.
import "@fontsource-variable/newsreader/opsz.css";
import "@fontsource-variable/atkinson-hyperlegible-next/wght.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Breach & Patch Range",
  description: "Four agents play attack and defend on a throwaway GCP project.",
};

export const viewport: Viewport = {
  colorScheme: "dark",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en-GB">
      <body className="antialiased" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
