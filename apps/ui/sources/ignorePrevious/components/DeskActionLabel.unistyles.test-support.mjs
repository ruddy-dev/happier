// Keep private compiled imports in JS so the UI typecheck does not traverse
// Unistyles private TS sources. Literals let Vite resolve symlinked dependencies.
/**
 * @typedef {{ fontFamily: string, fontSize: number, color: string }} LabelStyle
 * @returns {Promise<{
 *   create: (styles: { label: LabelStyle }) => { label: LabelStyle },
 *   services: { shadowRegistry: { addStyles: (styles: unknown[]) => { parsedStyles?: Record<string, unknown> } } }
 * }>}
 */
export async function loadInstalledUnistyles() {
    const { create } = await import('../../../node_modules/react-native-unistyles/lib/module/web/create.js');
    const { services } = await import('../../../node_modules/react-native-unistyles/lib/module/web/services.js');
    return { create, services };
}
