/**
 * Control usecase barrel export.
 *
 * All public functions are re-exported here so existing imports
 * from '@/app-layer/usecases/control' continue to work unchanged.
 */
export {
    listControls,
    listControlsPaginated,
    getControl,
    getControlHeader,
    getControlActivity,
    getControlDashboard,
    runConsistencyCheck,
    listControlsWithDeleted,
} from './queries';

export {
    createControl,
    updateControl,
    setControlStatus,
    setControlApplicability,
    setControlOwner,
    markControlTestCompleted,
    deleteControl,
    bulkDeleteControl,
    restoreControl,
    purgeControl,
} from './mutations';

export {
    listControlTasks,
    createControlTask,
    updateControlTask,
    deleteControlTask,
} from './tasks';

export {
    listEvidenceLinks,
    getControlEvidenceTab,
    linkEvidence,
    unlinkEvidence,
    linkAssetToControl,
    unlinkAssetFromControl,
    listContributors,
    addContributor,
    removeContributor,
} from './evidence';

export {
    listControlTemplates,
    installControlsFromTemplate,
    listFrameworks,
    listFrameworkRequirements,
    mapRequirementToControl,
    unmapRequirementFromControl,
    listControlMappings,
} from './templates';

// Page-data orchestration (collapses control + sync waterfall on detail page)
export { getControlPageData, type ControlPageDataPayload, type SyncStatusPayload } from './page-data';
