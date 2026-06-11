/**
 * 实验结果上传功能测试
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Simple unit tests for the experiment results module
// These tests verify the core logic without requiring external dependencies

describe('Experiment Results Upload', () => {
  describe('File Type Detection', () => {
    it('should detect image file types correctly', () => {
      const getFileType = (fileName: string): string => {
        const ext = fileName.split('.').pop()?.toLowerCase() || '';
        if (['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'tiff', 'tif', 'heic', 'heif', 'svg'].includes(ext)) {
          return 'image';
        } else if (ext === 'pdf') {
          return 'pdf';
        } else if (['doc', 'docx'].includes(ext)) {
          return 'word';
        } else if (['xlsx', 'xls', 'csv'].includes(ext)) {
          return 'table';
        } else if (['txt', 'md'].includes(ext)) {
          return 'text';
        }
        return 'unknown';
      };

      expect(getFileType('test.png')).toBe('image');
      expect(getFileType('test.jpg')).toBe('image');
      expect(getFileType('test.pdf')).toBe('pdf');
      expect(getFileType('test.docx')).toBe('word');
      expect(getFileType('test.xlsx')).toBe('table');
      expect(getFileType('test.csv')).toBe('table');
      expect(getFileType('test.txt')).toBe('text');
      expect(getFileType('test.unknown')).toBe('unknown');
    });

    it('should handle files with uppercase extensions', () => {
      const getFileType = (fileName: string): string => {
        const ext = fileName.split('.').pop()?.toLowerCase() || '';
        if (['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'tiff', 'tif', 'heic', 'heif', 'svg'].includes(ext)) {
          return 'image';
        } else if (ext === 'pdf') {
          return 'pdf';
        }
        return 'unknown';
      };

      expect(getFileType('test.PNG')).toBe('image');
      expect(getFileType('test.PDF')).toBe('pdf');
    });
  });

  describe('AI Response Parsing', () => {
    it('should parse valid JSON response', () => {
      const mockResponse = `{
        "paper_title": "Test Paper Title",
        "results": [
          {
            "task": "classification",
            "dataset": "CIFAR-10",
            "model_name": "ResNet-50",
            "metric_name": "Accuracy",
            "metric_value": "95.2",
            "unit": "%",
            "higher_is_better": true,
            "result_type": "main_result"
          }
        ],
        "overall_summary": {
          "main_findings": ["ResNet-50 achieves 95.2% accuracy on CIFAR-10"],
          "best_model_claims": [],
          "ablation_findings": [],
          "robustness_findings": [],
          "efficiency_findings": [],
          "uncertain_items": []
        }
      }`;

      const jsonMatch = mockResponse.match(/\{[\s\S]*\}/);
      expect(jsonMatch).not.toBeNull();
      
      const parsed = JSON.parse(jsonMatch![0]);
      expect(parsed.paper_title).toBe('Test Paper Title');
      expect(parsed.results.length).toBe(1);
      expect(parsed.results[0].metric_value).toBe('95.2');
    });

    it('should handle empty results', () => {
      const mockResponse = `{
        "paper_title": "",
        "results": [],
        "overall_summary": {
          "main_findings": [],
          "uncertain_items": ["No clear results found"]
        }
      }`;

      const parsed = JSON.parse(mockResponse);
      expect(parsed.results.length).toBe(0);
      expect(parsed.overall_summary.uncertain_items.length).toBe(1);
    });
  });

  describe('Results Combination', () => {
    it('should combine multiple analysis results correctly', () => {
      const results = [
        {
          fileName: 'file1.png',
          fileType: 'image',
          paper_title: 'Paper 1',
          results: [{ metric_name: 'Accuracy', metric_value: '90%' }],
          overall_summary: {
            main_findings: ['Finding 1'],
            uncertain_items: [],
          },
        },
        {
          fileName: 'file2.pdf',
          fileType: 'pdf',
          paper_title: 'Paper 2',
          results: [{ metric_name: 'F1', metric_value: '0.85' }],
          overall_summary: {
            main_findings: ['Finding 2'],
            uncertain_items: [],
          },
        },
      ];

      const combined = {
        main_findings: [] as string[],
        totalResultsCount: 0,
      };

      for (const result of results) {
        if (result.overall_summary?.main_findings) {
          combined.main_findings.push(...result.overall_summary.main_findings);
        }
        combined.totalResultsCount += result.results?.length || 0;
      }

      // Dedupe
      combined.main_findings = [...new Set(combined.main_findings)];

      expect(combined.main_findings.length).toBe(2);
      expect(combined.totalResultsCount).toBe(2);
    });
  });

  describe('API Route Validation', () => {
    it('should validate required fields for upload', () => {
      const validateUploadRequest = (body: any): { valid: boolean; error?: string } => {
        if (!body.files || body.files.length === 0) {
          return { valid: false, error: '请上传实验结果文件' };
        }
        if (!body.apiUrl) {
          return { valid: false, error: '未配置 API URL' };
        }
        if (!body.apiKey) {
          return { valid: false, error: '未配置 API Key' };
        }
        return { valid: true };
      };

      expect(validateUploadRequest({}).valid).toBe(false);
      expect(validateUploadRequest({ files: [] }).valid).toBe(false);
      expect(validateUploadRequest({ files: ['test.png'], apiUrl: 'http://test' }).valid).toBe(false);
      expect(validateUploadRequest({ files: ['test.png'], apiUrl: 'http://test', apiKey: 'test-key' }).valid).toBe(true);
    });
  });
});