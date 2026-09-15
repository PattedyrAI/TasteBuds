import type {Metadata,Viewport} from 'next';
import './globals.css';
import {AppConnection} from '@/components/install-app';
export const metadata:Metadata={applicationName:'TasteBuds',title:'TasteBuds — Good taste, shared.',description:'Keep the things you try and what your friends thought. Photo-first ratings for your private groups.',manifest:'/manifest.webmanifest',icons:{icon:'/icon.svg',apple:'/apple-touch-icon.png'},appleWebApp:{capable:true,title:'TasteBuds',statusBarStyle:'default'}};
export const viewport:Viewport={themeColor:'#3157D5',width:'device-width',initialScale:1};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="en"><body><AppConnection/>{children}</body></html>;}
