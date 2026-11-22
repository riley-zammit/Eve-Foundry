import { getFactory } from "@foundry/factory/db";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { Suspense } from "react";
import { listCatalogConnectors } from "../connector-catalog";
import { listGatewayModels } from "../models";
import { FactoryBuilder } from "./_components/FactoryBuilder";

export default function FactoryPage({ params }: PageProps<"/factories/[factoryId]">) {
    return (
        <Suspense fallback={<div className="p-6 text-sm text-zinc-500">Loading factory…</div>}>
            <FactoryBuilderWithFactory params={params} />
        </Suspense>
    );
}

async function FactoryBuilderWithFactory({ params }: Pick<PageProps<"/factories/[factoryId]">, "params">) {
    const { factoryId } = await params;
    // The factory is read per request, never prerendered.
    await connection();
    // Not awaited: the catalog streams in behind the builder, ready by the time the picker opens.
    const catalog = listCatalogConnectors();
    const [factory, models] = await Promise.all([getFactory(factoryId), listGatewayModels()]);
    if (!factory) {
        notFound();
    }
    return <FactoryBuilder key={factory.id} initialFactory={factory} models={models} catalog={catalog} />;
}
