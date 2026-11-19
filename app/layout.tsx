import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "BJJ Arena | Competições de jiu-jitsu",
  description: "Inscrições, checagem de atletas e gestão de competições no BJJ Arena.",
  icons: {
    icon: "/assets/logo_bjj_arena_ofc.png",
    shortcut: "/assets/logo_bjj_arena_ofc.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="pt-BR">
      <body className="antialiased">{children}</body>
    </html>
  );
}
