using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Runtime.InteropServices;

namespace LaokuaiUpdater
{
    public static class Discovery
    {
        public const string AppExeName = "唠蒯云.exe";
        public const int MaximumDepth = 2;
        public const int MaximumDirectories = 512;
        private const int ShortcutDirectories = 128;

        private sealed class Visit
        {
            public string Path;
            public int Depth;
            public Visit(string path, int depth) { Path = path; Depth = depth; }
        }

        private static string Normalize(string path)
        {
            try { return System.IO.Path.GetFullPath(path).TrimEnd(System.IO.Path.DirectorySeparatorChar, System.IO.Path.AltDirectorySeparatorChar); }
            catch (Exception) { return null; }
        }

        private static bool Plain(string path, bool directory)
        {
            try
            {
                FileAttributes attributes = File.GetAttributes(path);
                if (((attributes & FileAttributes.Directory) != 0) != directory) return false;
                UpdateEngine.AssertSafePath(path);
                return true;
            }
            catch (Exception) { return false; }
        }

        private static bool BroadRoot(string path)
        {
            string root = Normalize(System.IO.Path.GetPathRoot(path));
            string profile = Normalize(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile));
            return String.Equals(path, root, StringComparison.OrdinalIgnoreCase) ||
                String.Equals(path, profile, StringComparison.OrdinalIgnoreCase);
        }

        private static bool PrivateOrSystemDirectory(string path)
        {
            string name = System.IO.Path.GetFileName(path);
            if (name.StartsWith(".laokuai-update-", StringComparison.OrdinalIgnoreCase)) return true;
            foreach (string blocked in new string[] { "AppData", "laokuai-chat-data", "profile", "profiles", ".git", ".local", "node_modules", "Windows", "Users", "Program Files", "Program Files (x86)", "ProgramData" })
                if (String.Equals(name, blocked, StringComparison.OrdinalIgnoreCase)) return true;
            return false;
        }

        public static bool IsCandidateDirectory(string directory)
        {
            string path = Normalize(directory);
            if (path == null || !Plain(path, true)) return false;
            string resources = System.IO.Path.Combine(path, "resources");
            return Plain(resources, true) && Plain(System.IO.Path.Combine(path, AppExeName), false) &&
                Plain(System.IO.Path.Combine(resources, "app.asar"), false);
        }

        // Injected roots make fixture tests independent of the real desktop and processes.
        public static List<string> FindCandidates(IEnumerable<string> roots, int maxDepth, int maxDirectories)
        {
            if (roots == null) throw new ArgumentNullException("roots");
            if (maxDepth < 0 || maxDirectories < 1) throw new ArgumentOutOfRangeException();
            maxDepth = Math.Min(maxDepth, MaximumDepth);
            maxDirectories = Math.Min(maxDirectories, MaximumDirectories);
            Queue<Visit> queue = new Queue<Visit>();
            HashSet<string> queued = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (string input in roots)
            {
                string path = Normalize(input);
                if (path != null && !BroadRoot(path) && !PrivateOrSystemDirectory(path) && Plain(path, true) && queued.Add(path))
                    queue.Enqueue(new Visit(path, 0));
                if (queue.Count >= maxDirectories) break;
            }
            List<string> candidates = new List<string>();
            int visited = 0;
            while (queue.Count > 0 && visited < maxDirectories)
            {
                Visit visit = queue.Dequeue(); visited++;
                if (!Plain(visit.Path, true)) continue;
                if (IsCandidateDirectory(visit.Path))
                {
                    candidates.Add(visit.Path);
                    continue; // Do not enter an installation's account/configuration folders.
                }
                if (visit.Depth >= maxDepth) continue;
                try
                {
                    foreach (string child in Directory.EnumerateDirectories(visit.Path))
                    {
                        string path = Normalize(child);
                        if (path != null && !PrivateOrSystemDirectory(path) && Plain(path, true) && queued.Add(path))
                            queue.Enqueue(new Visit(path, visit.Depth + 1));
                        if (visited + queue.Count >= maxDirectories) break;
                    }
                }
                catch (Exception) { /* An inaccessible neighbor is not authority to scan elsewhere. */ }
            }
            candidates.Sort(StringComparer.OrdinalIgnoreCase);
            return candidates;
        }

        public static string SelectUniqueCandidate(IEnumerable<string> candidates)
        {
            string unique = null;
            HashSet<string> seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (string input in candidates)
            {
                string path = Normalize(input);
                if (path == null || !seen.Add(path)) continue;
                if (unique != null) return null;
                unique = path;
            }
            return unique;
        }

        public static List<string> GetRunningInstallDirectories()
        {
            List<string> paths = new List<string>();
            Process[] processes;
            try { processes = Process.GetProcessesByName(System.IO.Path.GetFileNameWithoutExtension(AppExeName)); }
            catch (Exception) { return paths; }
            foreach (Process process in processes)
            {
                using (process)
                {
                    try
                    {
                        string executable = process.MainModule.FileName;
                        if (String.Equals(System.IO.Path.GetFileName(executable), AppExeName, StringComparison.OrdinalIgnoreCase))
                            paths.Add(System.IO.Path.GetDirectoryName(executable));
                    }
                    catch (Exception) { /* Engine refuses an unreadable known process before applying. */ }
                }
            }
            return paths;
        }

        public static string ReadShortcutTargetDirectory(string shortcutPath)
        {
            if (!String.Equals(System.IO.Path.GetExtension(shortcutPath), ".lnk", StringComparison.OrdinalIgnoreCase) || !Plain(shortcutPath, false)) return null;
            object shell = null, shortcut = null;
            try
            {
                Type shellType = Type.GetTypeFromProgID("WScript.Shell", false);
                if (shellType == null) return null;
                shell = Activator.CreateInstance(shellType);
                shortcut = shellType.InvokeMember("CreateShortcut", BindingFlags.InvokeMethod, null, shell, new object[] { System.IO.Path.GetFullPath(shortcutPath) });
                Type type = shortcut.GetType();
                string target = Convert.ToString(type.InvokeMember("TargetPath", BindingFlags.GetProperty, null, shortcut, null));
                string arguments = Convert.ToString(type.InvokeMember("Arguments", BindingFlags.GetProperty, null, shortcut, null));
                if (!String.IsNullOrWhiteSpace(arguments) || String.IsNullOrWhiteSpace(target) || !System.IO.Path.IsPathRooted(target) ||
                    !String.Equals(System.IO.Path.GetFileName(target), AppExeName, StringComparison.OrdinalIgnoreCase)) return null;
                string directory = System.IO.Path.GetDirectoryName(target);
                return IsCandidateDirectory(directory) ? Normalize(directory) : null;
            }
            catch (Exception) { return null; }
            finally
            {
                if (shortcut != null && Marshal.IsComObject(shortcut)) Marshal.FinalReleaseComObject(shortcut);
                if (shell != null && Marshal.IsComObject(shell)) Marshal.FinalReleaseComObject(shell);
            }
        }

        private static void AddRoot(List<string> roots, string path)
        {
            string normalized = Normalize(path);
            if (normalized != null && !BroadRoot(normalized) && !roots.Contains(normalized)) roots.Add(normalized);
        }

        private static void AddShortcutTargets(List<string> roots, IEnumerable<string> shortcutRoots)
        {
            Queue<Visit> queue = new Queue<Visit>();
            HashSet<string> seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (string root in shortcutRoots)
                if (!String.IsNullOrEmpty(root) && Plain(root, true) && seen.Add(root)) queue.Enqueue(new Visit(root, 0));
            int visited = 0, shortcuts = 0;
            while (queue.Count > 0 && visited < ShortcutDirectories && shortcuts < MaximumDirectories)
            {
                Visit visit = queue.Dequeue(); visited++;
                if (!Plain(visit.Path, true)) continue;
                try
                {
                    foreach (string shortcut in Directory.EnumerateFiles(visit.Path, "*.lnk"))
                    {
                        AddRoot(roots, ReadShortcutTargetDirectory(shortcut));
                        if (++shortcuts >= MaximumDirectories) break;
                    }
                    if (visit.Depth >= MaximumDepth || IsCandidateDirectory(visit.Path)) continue;
                    foreach (string child in Directory.EnumerateDirectories(visit.Path))
                    {
                        if (Plain(child, true) && !PrivateOrSystemDirectory(child) && seen.Add(child)) queue.Enqueue(new Visit(child, visit.Depth + 1));
                        if (visited + queue.Count >= ShortcutDirectories) break;
                    }
                }
                catch (Exception) { }
            }
        }

        public static List<string> GetDefaultSearchRoots(string updaterPath)
        {
            List<string> roots = GetRunningInstallDirectories();
            string directory = System.IO.Path.GetDirectoryName(System.IO.Path.GetFullPath(updaterPath));
            AddRoot(roots, directory);
            DirectoryInfo parent = Directory.GetParent(directory);
            if (parent != null) AddRoot(roots, parent.FullName);
            // The Windows known folder follows Desktop redirection, including OneDrive.
            string desktop = Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory);
            string commonDesktop = Environment.GetFolderPath(Environment.SpecialFolder.CommonDesktopDirectory);
            AddRoot(roots, desktop); AddRoot(roots, commonDesktop);
            AddShortcutTargets(roots, new string[] { desktop, commonDesktop,
                Environment.GetFolderPath(Environment.SpecialFolder.StartMenu),
                Environment.GetFolderPath(Environment.SpecialFolder.CommonStartMenu) });
            return roots;
        }

        public static List<string> FindDefaultCandidates(string updaterPath)
        {
            // Shortcut directories and candidate directories share a fixed 512-directory ceiling.
            return FindCandidates(GetDefaultSearchRoots(updaterPath), MaximumDepth, MaximumDirectories - ShortcutDirectories);
        }
    }
}
