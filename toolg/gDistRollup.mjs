import rollupFiles from 'w-package-tools/src/rollupFiles.mjs'
import getFiles from 'w-package-tools/src/getFiles.mjs'


let fdSrc = './src'
let fdTar = './dist'


rollupFiles({
    fns: 'WDataSyncer.mjs',
    fdSrc,
    fdTar,
    // nameDistType: 'kebabCase',
    hookNameDist: () => {
        return 'w-data-syncer'
    },
    globals: {
        'path': 'path',
        'fs': 'fs',
    },
    external: [
        'path',
        'fs',
    ],
})

