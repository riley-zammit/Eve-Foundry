import { getFactory } from "@foundry/factory/db";
import { notFound } from "next/navigation";
import { Suspense } from "react";
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
    const factory = await getFactory(factoryId);
    if (!factory) {
        notFound();
    }
    return <FactoryBuilder key={factory.id} initialFactory={factory} />;
}
