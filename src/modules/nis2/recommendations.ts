/**
 * Maps the infrastructure areas a visitor selects to IWILL solution
 * *categories* — never to an individual product model.
 *
 * NIS2 is technology-neutral: no single device makes an organisation compliant,
 * so every recommendation is phrased as a technical review to perform.
 */

import type {
  InfrastructureNeed,
  SolutionCategoryId,
  SolutionRecommendation,
} from './rules/types';

export const SOLUTION_CATEGORIES: Record<SolutionCategoryId, SolutionRecommendation> = {
  NETWORK_SECURITY: {
    categoryId: 'NETWORK_SECURITY',
    title: 'Network Security',
    body:
      'Препоръчваме преглед на периметровата защита, VLAN сегментацията, VPN достъпа и резервираността.',
    href: '/solutions/mrezhova-sigurnost',
  },
  PRODUCTION_OT: {
    categoryId: 'PRODUCTION_OT',
    title: 'Production / OT',
    body:
      'Препоръчваме преглед на връзките между OT и IT мрежите, SCADA/HMI станциите и практиките за отдалечен достъп.',
    href: '/solutions/industrial-automation',
  },
  TOUCH_PANEL_HMI: {
    categoryId: 'TOUCH_PANEL_HMI',
    title: 'Touch Panel & HMI',
    body:
      'Препоръчваме технически преглед на производствените HMI/ERP/MES точки, индустриалните операторски станции и тяхната мрежова сегментация.',
    href: '/solutions/nis2-touch-paneli-hranitelno-proizvodstvo',
  },
  INDUSTRIAL_COMPUTING: {
    categoryId: 'INDUSTRIAL_COMPUTING',
    title: 'Industrial Computing',
    body:
      'Препоръчваме преглед на индустриалните и edge станциите — жизнен цикъл, поддържани операционни системи и възможност за контролирана подмяна.',
    href: '/solutions/edge-iot',
  },
  SECURE_REMOTE_ACCESS: {
    categoryId: 'SECURE_REMOTE_ACCESS',
    title: 'Secure Remote Access',
    body:
      'Препоръчваме преглед на отдалечения достъп до производствени и мрежови системи — кой, откъде и през какъв канал достига до тях.',
    href: '/solutions/mrezhova-sigurnost',
  },
  BUSINESS_CONTINUITY: {
    categoryId: 'BUSINESS_CONTINUITY',
    title: 'Business Continuity',
    body:
      'Препоръчваме преглед на резервираността, архивирането и възможността за възстановяване на критичните работни станции и мрежови устройства.',
    href: '/solutions/industrial-automation',
  },
};

/** Which solution categories each selected infrastructure area maps to. */
const NEED_TO_CATEGORIES: Record<InfrastructureNeed, SolutionCategoryId[]> = {
  CORPORATE_NETWORK_FIREWALL_VPN: ['NETWORK_SECURITY'],
  NETWORK_SEGMENTATION_VLAN: ['NETWORK_SECURITY', 'PRODUCTION_OT'],
  PRODUCTION_HMI_TOUCH_PANEL: ['TOUCH_PANEL_HMI', 'PRODUCTION_OT'],
  SCADA_OT: ['PRODUCTION_OT', 'INDUSTRIAL_COMPUTING'],
  INDUSTRIAL_EDGE_COMPUTING: ['INDUSTRIAL_COMPUTING'],
  SECURE_REMOTE_ACCESS: ['SECURE_REMOTE_ACCESS', 'NETWORK_SECURITY'],
  BACKUP_BUSINESS_CONTINUITY: ['BUSINESS_CONTINUITY'],
  MONITORING_LOGGING: ['NETWORK_SECURITY', 'BUSINESS_CONTINUITY'],
  LEGACY_WORKSTATION_REPLACEMENT: ['INDUSTRIAL_COMPUTING', 'TOUCH_PANEL_HMI'],
  NEW_PRODUCTION_LINE: ['PRODUCTION_OT', 'TOUCH_PANEL_HMI', 'INDUSTRIAL_COMPUTING'],
  NOT_SURE_WANT_CONSULTATION: [],
};

/** Stable display order, so the same selections always render identically. */
const CATEGORY_ORDER: SolutionCategoryId[] = [
  'NETWORK_SECURITY',
  'PRODUCTION_OT',
  'TOUCH_PANEL_HMI',
  'INDUSTRIAL_COMPUTING',
  'SECURE_REMOTE_ACCESS',
  'BUSINESS_CONTINUITY',
];

/**
 * Turn the selected infrastructure areas into solution categories to review.
 *
 * Selecting only "не сме сигурни" returns an empty list — the correct answer
 * there is a consultation, not a set of recommendations.
 */
export function recommendSolutionCategories(
  needs: InfrastructureNeed[],
): SolutionRecommendation[] {
  const selected = new Set<SolutionCategoryId>();
  for (const need of needs) {
    for (const category of NEED_TO_CATEGORIES[need] ?? []) selected.add(category);
  }
  return CATEGORY_ORDER.filter((id) => selected.has(id)).map((id) => SOLUTION_CATEGORIES[id]);
}

/** True when the visitor asked for a consultation instead of picking areas. */
export function wantsGuidedConsultation(needs: InfrastructureNeed[]): boolean {
  return needs.includes('NOT_SURE_WANT_CONSULTATION');
}
