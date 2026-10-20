import { env } from '../config/env.js';
import type { Settings } from '../core/settings.js';
import { DemoProvider } from './demo.js';
import { MetaBusinessDiscoveryProvider } from './meta.js';
import type { ProfileProvider, ProviderId } from './types.js';

export function createProvider(id: ProviderId): ProfileProvider | null {
  const e = env();
  if (id === 'meta_business_discovery') {
    return new MetaBusinessDiscoveryProvider({
      apiVersion: e.META_GRAPH_API_VERSION,
      igUserId: e.META_IG_USER_ID,
      accessToken: e.META_ACCESS_TOKEN,
      appSecret: e.META_APP_SECRET,
    });
  }
  if (id === 'demo') {
    return e.ALLOW_DEMO_PROVIDER === 'true' && e.NODE_ENV !== 'production' ? new DemoProvider() : null;
  }
  return null;
}

export function activeProvider(settings: Settings): ProfileProvider | null {
  return createProvider(settings.activeProvider);
}

// Informação pública (sem segredos) sobre as fontes, para a tela de Configurações.
export function describeProviders() {
  const e = env();
  const list: ProviderId[] = ['meta_business_discovery'];
  if (e.ALLOW_DEMO_PROVIDER === 'true' && e.NODE_ENV !== 'production') list.push('demo');
  return list.map((id) => {
    const p = createProvider(id)!;
    return {
      id: p.id,
      displayName: p.displayName,
      isDemo: p.isDemo,
      capabilities: p.capabilities,
      config: p.configStatus(),
    };
  });
}
