param(
  [string]$AvatarDirectory = (Join-Path $PSScriptRoot '..\src\public\avatars'),
  [int]$TargetStart = 1,
  [int]$TargetEnd = 56,
  [int]$ReferenceStart = 57,
  [int]$ReferenceEnd = 79,
  [int]$ColorDistanceThreshold = 42,
  [string]$BackupDirectory = (Join-Path $PSScriptRoot '..\artifacts\avatar-background-backup')
)

$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Drawing

if (-not ('ScholarHarness.AvatarBackgroundRestyler' -as [type])) {
  $drawingAssemblies = [AppDomain]::CurrentDomain.GetAssemblies() |
    Where-Object { -not $_.IsDynamic -and $_.Location } |
    Select-Object -ExpandProperty Location -Unique
  Add-Type -ReferencedAssemblies $drawingAssemblies -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Drawing.Imaging;
using System.IO;

namespace ScholarHarness
{
    public static class AvatarBackgroundRestyler
    {
        private static bool IsNear(Color candidate, Color source, int thresholdSquared)
        {
            int red = candidate.R - source.R;
            int green = candidate.G - source.G;
            int blue = candidate.B - source.B;
            return red * red + green * green + blue * blue <= thresholdSquared;
        }

        private static int FloodFromSeed(
            Bitmap source,
            Bitmap output,
            Color background,
            Color replacement,
            int thresholdSquared,
            int seedX,
            int seedY)
        {
            int width = source.Width;
            int height = source.Height;
            bool[] visited = new bool[width * height];
            Queue<int> queue = new Queue<int>();
            int changed = 0;

            Action<int, int> enqueue = (x, y) =>
            {
                int index = y * width + x;
                if (visited[index]) return;
                visited[index] = true;
                if (IsNear(source.GetPixel(x, y), background, thresholdSquared))
                {
                    queue.Enqueue(index);
                }
            };

            enqueue(seedX, seedY);
            while (queue.Count > 0)
            {
                int index = queue.Dequeue();
                int x = index % width;
                int y = index / width;
                output.SetPixel(x, y, replacement);
                changed++;

                if (x > 0) enqueue(x - 1, y);
                if (x + 1 < width) enqueue(x + 1, y);
                if (y > 0) enqueue(x, y - 1);
                if (y + 1 < height) enqueue(x, y + 1);
            }

            return changed;
        }

        public static int ReplaceConnectedBackground(
            string inputPath,
            Color replacement,
            int distanceThreshold)
        {
            string temporaryPath = inputPath + ".restyled.png";
            int changed = 0;
            using (Bitmap source = new Bitmap(inputPath))
            using (Bitmap output = new Bitmap(source))
            {
                int width = source.Width;
                int height = source.Height;
                int thresholdSquared = Math.Max(0, distanceThreshold) * Math.Max(0, distanceThreshold);
                Color background = source.GetPixel(2, 2);
                bool[] visited = new bool[width * height];
                Queue<int> queue = new Queue<int>();

                Action<int, int> enqueue = (x, y) =>
                {
                    int index = y * width + x;
                    if (visited[index]) return;
                    visited[index] = true;
                    if (IsNear(source.GetPixel(x, y), background, thresholdSquared))
                    {
                        queue.Enqueue(index);
                    }
                };

                for (int x = 0; x < width; x++)
                {
                    enqueue(x, 0);
                    enqueue(x, height - 1);
                }
                for (int y = 1; y < height - 1; y++)
                {
                    enqueue(0, y);
                    enqueue(width - 1, y);
                }

                while (queue.Count > 0)
                {
                    int index = queue.Dequeue();
                    int x = index % width;
                    int y = index / width;
                    output.SetPixel(x, y, replacement);
                    changed++;

                    if (x > 0) enqueue(x - 1, y);
                    if (x + 1 < width) enqueue(x + 1, y);
                    if (y > 0) enqueue(x, y - 1);
                    if (y + 1 < height) enqueue(x, y + 1);
                }

                // A few legacy avatars contain a light picture-frame margin around
                // their actual colored background. The edge flood above correctly
                // replaces the frame but cannot cross into that enclosed region.
                // Detect the inset background and flood it independently while
                // preserving the outlined character in the foreground.
                int insetX = Math.Min(10, Math.Max(0, width - 1));
                int insetY = Math.Min(10, Math.Max(0, height - 1));
                Color insetBackground = source.GetPixel(insetX, insetY);
                if (!IsNear(insetBackground, background, thresholdSquared))
                {
                    int frameWidth = Math.Min(8, Math.Min(width / 2, height / 2));
                    for (int x = 0; x < width; x++)
                    {
                        for (int y = 0; y < frameWidth; y++)
                        {
                            output.SetPixel(x, y, replacement);
                            output.SetPixel(x, height - 1 - y, replacement);
                        }
                    }
                    for (int y = frameWidth; y < height - frameWidth; y++)
                    {
                        for (int x = 0; x < frameWidth; x++)
                        {
                            output.SetPixel(x, y, replacement);
                            output.SetPixel(width - 1 - x, y, replacement);
                        }
                    }
                    changed += FloodFromSeed(
                        source,
                        output,
                        insetBackground,
                        replacement,
                        thresholdSquared,
                        insetX,
                        insetY
                    );
                }

                output.Save(temporaryPath, ImageFormat.Png);
            }
            File.Copy(temporaryPath, inputPath, true);
            File.Delete(temporaryPath);
            return changed;
        }
    }
}
'@
}

$avatarRoot = [System.IO.Path]::GetFullPath($AvatarDirectory)
$backupRoot = [System.IO.Path]::GetFullPath($BackupDirectory)

if (-not (Test-Path -LiteralPath $avatarRoot)) {
  throw "Avatar directory does not exist: $avatarRoot"
}

New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null

$palette = @()
for ($index = $ReferenceStart; $index -le $ReferenceEnd; $index++) {
  $referencePath = Join-Path $avatarRoot ('avatar-{0:D2}.png' -f $index)
  if (-not (Test-Path -LiteralPath $referencePath)) {
    throw "Reference avatar is missing: $referencePath"
  }
  $reference = [System.Drawing.Bitmap]::new($referencePath)
  try {
    $palette += $reference.GetPixel(2, 2)
  } finally {
    $reference.Dispose()
  }
}

if ($palette.Count -eq 0) {
  throw 'No reference background colors were found.'
}

$results = @()
for ($index = $TargetStart; $index -le $TargetEnd; $index++) {
  $avatarPath = Join-Path $avatarRoot ('avatar-{0:D2}.png' -f $index)
  if (-not (Test-Path -LiteralPath $avatarPath)) {
    throw "Target avatar is missing: $avatarPath"
  }

  $backupPath = Join-Path $backupRoot ('avatar-{0:D2}.png' -f $index)
  if (-not (Test-Path -LiteralPath $backupPath)) {
    Copy-Item -LiteralPath $avatarPath -Destination $backupPath
  }

  $replacement = $palette[($index - 1) % $palette.Count]
  $changedPixels = [ScholarHarness.AvatarBackgroundRestyler]::ReplaceConnectedBackground(
    $avatarPath,
    $replacement,
    $ColorDistanceThreshold
  )
  $results += [pscustomobject]@{
    Avatar = ('avatar-{0:D2}.png' -f $index)
    Background = ('#{0:X2}{1:X2}{2:X2}' -f $replacement.R, $replacement.G, $replacement.B)
    ChangedPixels = $changedPixels
  }
}

$results
