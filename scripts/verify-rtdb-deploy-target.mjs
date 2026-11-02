import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

/**
 * The RTDB instances that `firebase deploy --only database:<target>` releases rules
 * to for a project. firebase.json declares the rules as deploy targets, and the
 * Firebase CLI resolves each target through .firebaserc only at the final deploy
 * step, so a project without a mapping would fail after App Check and the index
 * deploy have already run. A single-object database config ignores the target
 * filter and deploys to the project's default instance, so it is refused too.
 */
export function rtdbDeployTargets(firebase, firebaserc, project) {
  // Google Cloud project ID format, so a stray flag cannot pass as a project.
  if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(project ?? "")) throw new Error("A valid --project is required.");
  if (!Array.isArray(firebase.database) || firebase.database.length === 0) {
    throw new Error("firebase.json must declare the RTDB rules as deploy targets.");
  }
  return firebase.database.map(({ target }) => {
    const instances = target ? firebaserc.targets?.[project]?.database?.[target] : undefined;
    if (!instances?.length) {
      throw new Error(`.firebaserc maps no RTDB instance to the deploy target "${target}" for ${project}.`);
    }
    return { target, instances };
  });
}

const invokedDirectly = process.argv[1] &&
  pathToFileURL(process.argv[1]).href === import.meta.url;
if (invokedDirectly) {
  const index = process.argv.indexOf("--project");
  const project = index > 0 ? process.argv[index + 1] : undefined;
  const read = (name) => JSON.parse(readFileSync(new URL(`../${name}`, import.meta.url), "utf8"));
  for (const { target, instances } of rtdbDeployTargets(read("firebase.json"), read(".firebaserc"), project)) {
    console.log(`RTDB deploy target ${target} for ${project}: ${instances.join(", ")}.`);
  }
}
