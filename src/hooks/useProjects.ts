import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { ProjectConfig } from "../types";

export type GroupedProjects = Record<ProjectConfig["category"], ProjectConfig[]>;

const CATEGORY_ORDER: ProjectConfig["category"][] = [
  "game",
  "app",
  "framework",
  "infra",
  "personal",
  "adhoc",
  "discovered",
];

export function useProjects() {
  const [projects, setProjects] = useState<ProjectConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        // Load configured projects
        const configured = await invoke<ProjectConfig[]>("get_projects");

        // Scan for undiscovered repos in devRoot (if configured)
        let discovered: ProjectConfig[] = [];
        try {
          discovered = await invoke<ProjectConfig[]>("scan_dev_repos");
        } catch {
          // scan may fail, that's fine
        }

        if (!cancelled) {
          setProjects([...configured, ...discovered]);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(String(err));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const grouped: GroupedProjects = CATEGORY_ORDER.reduce(
    (acc, cat) => {
      const matching = projects.filter((p) => p.category === cat);
      if (matching.length > 0) {
        acc[cat] = matching;
      }
      return acc;
    },
    {} as GroupedProjects,
  );

  // Expose a way to add projects at runtime
  const addProject = (project: ProjectConfig) => {
    setProjects((prev) => {
      if (prev.some((p) => p.id === project.id)) return prev;
      return [...prev, project];
    });
  };

  return { projects, grouped, loading, error, addProject };
}
