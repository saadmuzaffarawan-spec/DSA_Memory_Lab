/// <reference types="vite/client" />
declare module '*.hpp?raw' { const s: string; export default s; }
declare module '*?worker&inline' { const W: { new (): Worker }; export default W; }
