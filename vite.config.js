import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { localSlackPlugin } from './server/slackBridge.js'
import { localN8nRecipePlugin } from './server/n8nRecipeBridge.js'
import { localCalculationPlugin } from './server/trustedCalculation.js'
import { localDocumentIntakePlugin } from './server/documentIntake.js'

export default defineConfig(({ mode }) => ({
    optimizeDeps: { include: ['jspdf'] },
    plugins: [react(), localSlackPlugin(loadEnv(mode, process.cwd(), '')), localN8nRecipePlugin(loadEnv(mode, process.cwd(), '')), localCalculationPlugin(loadEnv(mode, process.cwd(), '')), localDocumentIntakePlugin(loadEnv(mode, process.cwd(), ''))],
}))
