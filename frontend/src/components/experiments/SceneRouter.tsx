import {memo} from 'react';
import {
  ColumnCombinationExperiment, EigenDecompositionExperiment, MatrixAdditionExperiment,
  VectorFamilyExperiment,
} from './BasicScenes';
import {ShearCompareExperiment, SvdProcessExperiment} from './DecompositionScenes';
import {BasisChangeExperiment, EigenProbeExperiment, InverseExperiment} from './GuidedScenes';
import {ChangeOfBasisExperiment, DetAreaExperiment, PerturbationExperiment, RankSpaceExperiment} from './SpatialScenes';
import type {SceneComponentProps} from './sceneTypes';

export const SPECIALIZED_SCENES = new Set([
  'vector_family', 'eigen_probe_lab', 'column_combination', 'matrix_addition',
  'eigen_decomposition', 'svd_process', 'shear_compare', 'rank_space',
  'det_area_lab', 'inverse_lab', 'perturbation', 'basis_change_lab',
  'change_of_basis',
]);

export const SceneRouter = memo(function SceneRouter({sceneType, ...props}: SceneComponentProps & {sceneType: string}) {
  switch (sceneType) {
    case 'vector_family': return <VectorFamilyExperiment {...props}/>;
    case 'eigen_probe_lab': return <EigenProbeExperiment {...props}/>;
    case 'column_combination': return <ColumnCombinationExperiment {...props}/>;
    case 'matrix_addition': return <MatrixAdditionExperiment {...props}/>;
    case 'eigen_decomposition': return <EigenDecompositionExperiment {...props}/>;
    case 'svd_process': return <SvdProcessExperiment {...props}/>;
    case 'shear_compare': return <ShearCompareExperiment {...props}/>;
    case 'rank_space': return <RankSpaceExperiment {...props}/>;
    case 'det_area_lab': return <DetAreaExperiment {...props}/>;
    case 'inverse_lab': return <InverseExperiment {...props}/>;
    case 'perturbation': return <PerturbationExperiment {...props}/>;
    case 'basis_change_lab': return <BasisChangeExperiment {...props}/>;
    case 'change_of_basis': return <ChangeOfBasisExperiment {...props}/>;
    default: return null;
  }
});
