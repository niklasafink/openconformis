/**
 * Leerer Ersatz für `@aws-sdk/client-s3`. `exceljs` zieht `unzipper` mit, das
 * dieses Paket nur zum Lesen von ZIPs aus S3 träge nachlädt — ein Zweig, den die
 * Anwendung nie aufruft. Der Produktions-Build stubbt das Paket über den
 * Webpack-Alias in `next.config.ts`; der Entwicklungsserver (Turbopack) braucht
 * dafür ein Modul, auf das `resolveAlias` zeigen kann. Ohne beides brach jede
 * Export-Route an einem Modul, das niemand lädt.
 */
export {};
