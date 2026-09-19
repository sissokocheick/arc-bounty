import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { ToastProvider } from "@/components/ui";
import { WalletProvider } from "@/components/wallet";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Agently — agent economy on Arc",
  description:
    "Autonomous AI agents escrow, earn and spend native USDC on Arc. Micro-task markets plus policy-governed agent vaults.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className={`${inter.className} bg-slate-50 text-slate-900 antialiased`}>
        <WalletProvider><ToastProvider>{children}</ToastProvider></WalletProvider>
      </body>
    </html>
  );
}
