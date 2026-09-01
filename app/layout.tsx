import type { Metadata } from 'next';
import { Noto_Sans_TC, Noto_Serif_TC } from 'next/font/google';
import './globals.css';

const sans = Noto_Sans_TC({ variable: '--font-noto', subsets: ['latin'], display: 'swap' });
const serif = Noto_Serif_TC({ variable: '--font-serif', subsets: ['latin'], display: 'swap' });

export const metadata: Metadata = {
  metadataBase: new URL('https://wedding-welcome.likewers.chatgpt.site'),
  title: '好日子迎賓',
  description: '婚宴當日的賓客接待、紅包、喜餅與現場進度管理工具。',
  openGraph: {
    title: '好日子迎賓',
    description: '婚宴當日接待與現場進度',
    type: 'website',
    images: [{ url: '/og.png', width: 1730, height: 909, alt: '好日子迎賓' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: '好日子迎賓',
    description: '婚宴當日接待與現場進度',
    images: ['/og.png'],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-Hant"><body className={`${sans.variable} ${serif.variable}`}>{children}</body></html>;
}
