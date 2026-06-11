import { describe, it, expect } from 'vitest';
import { RISParser } from '../../src/literature/parsers/ris-parser';
import { ParserFactory } from '../../src/literature/parsers/index';

// 知网导出的 RIS 格式样例
const CNKI_RIS_SAMPLE = `RT Journal Article
SR 1
A1 Sharma Ashutosh;Georgi Mikhail;Tregubenko Maxim;Tselykh Alexey;Tselykh Alexander
T1 Enabling Smart Agriculture by Implementing Artificial Intelligence and Embedded Sensing
JF Computers & Industrial Engineering
YR 2022
IS prepublish
OP 107936-
K1 Computational intelligence technique;genetic algorithm;artificial neural network;varying lighting illuminations;color normalization
AB The increasing demand of smart agriculture has led to the significant growth and development in the field of crop estimation and prediction improving its productivity. The analysis of crop age status is very important to prevent the excessive fertilization, understand the proper time to harvest and reduce the production cost.
SN 0360-8352
DS CNKI
LK https://link.cnki.net/doi/10.1016/J.CIE.2022.107936
DO 10.1016/J.CIE.2022.107936

RT Journal Article
SR 1
A1 康春鹏
AD 农业农村部信息中心;
T1 智慧农业建设的时代方位、突出亮点和问题建议
JF 农村工作通讯
YR 2022
IS 02
OP 23-25
AB 党中央、国务院高度重视网络安全与信息化,在农业农村信息化方面,习近平总书记多次强调要瞄准农业现代化的主攻方向,提高农业生产智能化和经营网络化水平。
SN 0546-9503
CN 11-1617/F
LA 中文;
DS CNKI
LK https://kns.cnki.net/kcms2/article/abstract?v=xxx`;

// 标准 RIS 格式样例
const STANDARD_RIS_SAMPLE = `TY  - JOUR
AU  - Smith, John
AU  - Doe, Jane
TI  - A Standard RIS Format Example
SO  - Journal of Testing
PY  - 2023
AB  - This is a standard RIS format abstract.
KW  - testing;RIS;format
DO  - 10.1234/test.2023
ER  -`;

const RIS_WITHOUT_DOI_SAMPLE = `TY  - JOUR
AU  - Yang, Jie
TI  - Cropping systems and water consumption in the North China Plain
SO  - Water
PY  - 2020
AB  - First abstract sentence about maize systems.
      Continuation sentence should remain part of the abstract.
KW  - maize
KW  - water consumption
ER  -`;

describe('RISParser - CNKI RIS Format Support', () => {
  const parser = new RISParser();

  describe('validate', () => {
    it('should validate standard RIS format with TY -', () => {
      expect(parser.validate(STANDARD_RIS_SAMPLE)).toBe(true);
    });

    it('should validate CNKI RIS format with RT Journal Article', () => {
      expect(parser.validate(CNKI_RIS_SAMPLE)).toBe(true);
    });

    it('should validate CNKI RIS format with RT Book', () => {
      expect(parser.validate('RT Book\nT1 Test Book')).toBe(true);
    });

    it('should reject invalid RIS format', () => {
      expect(parser.validate('Invalid content')).toBe(false);
    });
  });

  describe('parse CNKI RIS format', () => {
    it('should parse CNKI RIS content via ParserFactory', () => {
      const results = ParserFactory.parseContent(CNKI_RIS_SAMPLE);
      
      expect(results.length).toBe(2);
      
      // 第一篇文献（英文）
      const first = results[0];
      expect(first.title).toBe('Enabling Smart Agriculture by Implementing Artificial Intelligence and Embedded Sensing');
      expect(first.year).toBe(2022);
      expect(first.journal).toBe('Computers & Industrial Engineering');
      expect(first.abstract).toContain('smart agriculture');
      expect(first.keywords.length).toBeGreaterThan(0);
      expect(first.doi).toBe('10.1016/J.CIE.2022.107936');
      
      // 作者解析（分号分隔）
      expect(first.authors.length).toBe(5);
      expect(first.authors[0].name).toBe('Sharma Ashutosh');
      expect(first.authors[1].name).toBe('Georgi Mikhail');
      
      // 第二篇文献（中文）
      const second = results[1];
      expect(second.title).toBe('智慧农业建设的时代方位、突出亮点和问题建议');
      expect(second.year).toBe(2022);
      expect(second.journal).toBe('农村工作通讯');
      expect(second.abstract).toContain('党中央');
      expect(second.authors[0].name).toBe('康春鹏');
      expect(second.pages).toBe('23-25');
    });
  });

  describe('parse standard RIS format', () => {
    it('should parse standard RIS content via ParserFactory', () => {
      const results = ParserFactory.parseContent(STANDARD_RIS_SAMPLE);
      
      expect(results.length).toBe(1);
      
      const paper = results[0];
      expect(paper.title).toBe('A Standard RIS Format Example');
      expect(paper.year).toBe(2023);
      expect(paper.journal).toBe('Journal of Testing');
      expect(paper.abstract).toBe('This is a standard RIS format abstract.');
      expect(paper.authors.length).toBe(2);
      expect(paper.authors[0].name).toBe('Smith, John');
    });

    it('should keep abstracts and keywords when DOI is missing', () => {
      const results = ParserFactory.parseContent(RIS_WITHOUT_DOI_SAMPLE);

      expect(results).toHaveLength(1);
      expect(results[0].doi).toBe('');
      expect(results[0].abstract).toContain('First abstract sentence');
      expect(results[0].abstract).toContain('Continuation sentence');
      expect(results[0].keywords).toEqual(['maize', 'water consumption']);
    });
  });
});
