/**
 * The files change #216 in dana/gitfs touches, whole: on main and at each of
 * its three patch sets. The review screen draws its diffs from these, and an
 * edit in the browser starts from them.
 */
export const change216 = {
  base: {
    'src/refs.rs':
      'pub struct Refs {\n    disk: Disk,\n}\n\nimpl Refs {\n    pub fn lookup(&self, name: &str) -> Option<Oid> {\n        self.disk.read_ref(name)\n    }\n}\n',
    'tests/refs_test.rs': '#[test]\nfn lookup_reads_disk_once() {\n}\n',
  } as Record<string, string | null>,
  versions: [
    {
      'src/refs.rs':
        'pub struct Refs {\n    disk: Disk,\n    neg: NegCache,\n}\n\nimpl Refs {\n    pub fn lookup(&self, name: &str) -> Option<Oid> {\n        if self.neg.hit(name) {\n            return None;\n        }\n        self.disk\n            .read_ref(name)\n            .or_else(|| self.neg.remember(name))\n    }\n}\n',
      'tests/refs_test.rs':
        '#[test]\nfn lookup_reads_disk_once() {\n    let refs = Refs::with_counter();\n    assert!(refs.lookup("refs/heads/missing").is_none());\n    assert!(refs.lookup("refs/heads/missing").is_none());\n}\n',
    },
    {
      'src/refs.rs':
        'pub struct Refs {\n    disk: Disk,\n    neg: NegCache,\n}\n\nimpl Refs {\n    pub fn lookup(&self, name: &str) -> Option<Oid> {\n        if self.neg.contains(name) {\n            return None;\n        }\n        self.disk\n            .read_ref(name)\n            .or_else(|| self.neg.remember(name))\n    }\n}\n',
      'tests/refs_test.rs':
        '#[test]\nfn lookup_reads_disk_once() {\n    let refs = Refs::with_counter();\n    assert!(refs.lookup("refs/heads/missing").is_none());\n    assert!(refs.lookup("refs/heads/missing").is_none());\n    assert_eq!(refs.disk_reads(), 1);\n}\n',
    },
    {
      'src/refs.rs':
        'pub struct Refs {\n    disk: Disk,\n    neg: NegCache,\n}\n\nimpl Refs {\n    pub fn lookup(&self, name: &str) -> Option<Oid> {\n        if self.neg.contains(name) {\n            return None;\n        }\n        self.disk\n            .read_ref(name)\n            .or_else(|| self.neg.put(name))\n    }\n}\n',
      'tests/refs_test.rs':
        '#[test]\nfn lookup_reads_disk_once() {\n    let refs = Refs::with_counter();\n    assert!(refs.lookup("refs/heads/missing").is_none());\n    assert!(refs.lookup("refs/heads/missing").is_none());\n    assert_eq!(refs.disk_reads(), 1);\n}\n',
    },
  ] as Array<Record<string, string | null>>,
}
