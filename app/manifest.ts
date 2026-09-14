import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Dalai Eej Ops',
    short_name: 'Dalai Ops',
    description: 'Dalai Eej adaptive operations app and point of sale',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#f3f4f6',
    theme_color: '#047857',
    icons: [
      { src: '/branding/favicons/web-app-manifest-192x192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/branding/favicons/web-app-manifest-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    ],
  };
}
