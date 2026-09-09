import {readFile,readdir,writeFile,mkdir,stat} from 'node:fs/promises';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
export async function webLicenseNotices(output){
  await mkdir(output,{recursive:true});
  const project=JSON.parse(await readFile(join(root,'platform/package.json'),'utf8'));
  const supplemental=JSON.parse(await readFile(join(root,'third_party/npm-licenses/sources.json'),'utf8')).packages;
  const included=new Set(),notices=[],missing=[];
  async function locate(name,from){
    for(let current=from;;current=dirname(current)){
      const folder=join(current,'node_modules',name);
      try{await stat(join(folder,'package.json'));return folder;}catch(error){if(error.code!=='ENOENT')throw error;}
      if(current===dirname(current))return null;
    }
  }
  async function visit(name,from,optional=false){
    const folder=await locate(name,from);
    if(!folder){if(optional)return;throw Error('Missing runtime dependency '+name);}
    if(included.has(folder))return;included.add(folder);
    const pkg=JSON.parse(await readFile(join(folder,'package.json'),'utf8'));
    const texts=[];
    for(const file of await readdir(folder,{withFileTypes:true}))if(file.isFile()&&/^(license|copying|notice)(\.|$|-)/i.test(file.name))texts.push(file.name+'\n'+await readFile(join(folder,file.name),'utf8'));
    const file=pkg.name.replaceAll('/','__')+'-'+pkg.version+'.txt';
    let noticeKind='distributed-license';
    if(!texts.length){
      const source=supplemental.find(p=>p.name===pkg.name&&p.version===pkg.version);
      if(source){
        const bytes=await readFile(join(root,'third_party/npm-licenses',source.file));
        if(createHash('sha256').update(bytes).digest('hex')!==source.sha256||source.license!==pkg.license)throw Error('Supplemental notice differs: '+pkg.name);
        texts.push('Source: '+source.source+'\n'+source.license_note+'\n\n'+bytes.toString('utf8'));noticeKind='upstream-license';
      }
    }
    if(!texts.length&&pkg.license==='MIT'&&['is-reference','locate-character'].includes(pkg.name)){
      // These upstream versions publish the MIT declaration in metadata and
      // README, but no separate license/copyright file. Preserve what they publish.
      texts.push('No separate upstream license file. Original package metadata and README follow.\n\npackage.json\n'+await readFile(join(folder,'package.json'),'utf8')+'\n\nREADME.md\n'+await readFile(join(folder,'README.md'),'utf8'));noticeKind='upstream-metadata-and-readme';
    }
    if(!texts.length)missing.push(pkg.name+'@'+pkg.version);
    await writeFile(join(output,file),texts.join('\n\n'));
    notices.push({name:pkg.name,version:pkg.version,license:pkg.license,repository:pkg.repository,notice:file,notice_kind:noticeKind});
    for(const dependency of Object.keys({...pkg.dependencies,...pkg.optionalDependencies}).sort())await visit(dependency,folder,dependency in (pkg.optionalDependencies??{}));
  }
  for(const name of [...new Set([...Object.keys(project.dependencies),'svelte','@sveltejs/kit'])].sort())await visit(name,join(root,'platform'));
  if(missing.length)throw Error('Missing runtime dependency license text: '+missing.join(', '));
  notices.sort((a,b)=>a.name.localeCompare(b.name)||a.version.localeCompare(b.version));
  await writeFile(join(output,'dependencies.json'),JSON.stringify(notices,null,2)+'\n');
  await writeFile(join(output,'README.txt'),'License texts for the installed application dependency graph, including SvelteKit and Svelte. Some packages support building and are not included in every runtime chunk. Original notices and package versions are retained.\n');
  return notices.length;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  if(!process.argv[2])throw Error('Specify a notice output directory');
  console.log(JSON.stringify({dependency_notices:await webLicenseNotices(resolve(process.argv[2]))}));
}
