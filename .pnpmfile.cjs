/**
 * The Neon Auth beta currently declares its optional React UI as a mandatory
 * dependency. This application uses only @neondatabase/auth/next and
 * @neondatabase/auth/next/server. Excluding the unused UI avoids shipping its
 * large client-side tree and AGPL-licensed ua-parser-js transitive dependency.
 */
function readPackage(pkg) {
  if (pkg.name === "@neondatabase/auth" && pkg.version === "0.5.0-beta") {
    pkg.dependencies = { ...pkg.dependencies };
    delete pkg.dependencies["@neondatabase/auth-ui"];
  }

  return pkg;
}

module.exports = { hooks: { readPackage } };
