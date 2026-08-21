import { PpobRepository } from "../domain/PpobRepository.js";
import { PpobCatalogCategoryView } from "../domain/ppobModels.js";

export class PpobCatalogService {
  constructor(private readonly ppobRepository: PpobRepository) {}

  getCatalog(): Promise<PpobCatalogCategoryView[]> {
    return this.ppobRepository.listCatalog();
  }
}
